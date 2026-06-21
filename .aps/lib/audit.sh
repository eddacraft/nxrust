#!/usr/bin/env bash
#
# Plan-vs-reality audit
#
# `aps audit [module]` compares the *claimed* state of a plan (module and
# work-item Status lines) against the *evidence* in the same documents and the
# repository CHANGELOG, and reports three kinds of drift:
#
#   overstated   Claimed Complete/Done, but the evidence says otherwise —
#                unchecked acceptance boxes, open TODO checkboxes, or an
#                "unreleased" / "in progress" sub-note under a terminal status.
#   understated  Claimed Proposed/Ready, but a sub-note says it was actually
#                Done / Released / Complete / shipped — status not promoted.
#   stale        A status that says "unreleased" even though a *released*
#                CHANGELOG version entry already names that work item, so the
#                "unreleased" note is dangling.
#
# Findings reuse the shared results store (add_result / print_*_results) so the
# output mirrors `aps lint`. Like lint, a clean audit exits 0 and any finding
# exits non-zero. Findings use A-prefixed codes (A001 overstated, A002
# understated, A003 stale).

# Terminal/"done" status words shared by several checks.
AUDIT_DONE_RE='(done|complete|completed|merged|released|shipped)'
# Not-yet-started / pending status words.
AUDIT_OPEN_RE='(proposed|ready|draft|deferred|blocked|in progress)'

# Resolve a `[module]` argument to a module file under plans/modules/.
# Accepts a file stem ("04-cache-semantics"), a bare path, or a module ID
# prefix as it appears in the metadata table ("CACHE"). Prints the path on
# success, nothing on failure.
# Usage: audit_resolve_module "plans" "04-cache-semantics"
audit_resolve_module() {
  local plan_root="$1"
  local query="$2"
  local mod_dir="$plan_root/modules"

  # Direct path or stem match first.
  if [[ -f "$query" ]]; then
    echo "$query"
    return 0
  fi
  if [[ -f "$mod_dir/$query" ]]; then
    echo "$mod_dir/$query"
    return 0
  fi
  if [[ -f "$mod_dir/$query.aps.md" ]]; then
    echo "$mod_dir/$query.aps.md"
    return 0
  fi

  # Stem prefix match (e.g. "04" -> 04-cache-semantics.aps.md).
  local f
  for f in "$mod_dir/$query"*.aps.md; do
    [[ -e "$f" ]] || continue
    echo "$f"
    return 0
  done

  # Module-ID match against the metadata table (e.g. "CACHE").
  local upper
  upper=$(echo "$query" | tr '[:lower:]' '[:upper:]')
  for f in "$mod_dir"/*.aps.md; do
    [[ -e "$f" ]] || continue
    [[ "$(basename "$f")" == .* ]] && continue
    local id
    id=$(get_module_id "$f")
    if [[ "$(echo "$id" | tr '[:lower:]' '[:upper:]')" == "$upper" ]]; then
      echo "$f"
      return 0
    fi
  done

  return 1
}

# Set of work-item IDs named by *released* CHANGELOG version entries (i.e. not
# the "## Unreleased" block). Used by the stale check: an item whose status
# still says "unreleased" while a released version already names it is stale.
# Populated once per audit run via audit_load_released_ids.
AUDIT_RELEASED_IDS=""

# Usage: audit_load_released_ids [changelog-path]
audit_load_released_ids() {
  local changelog="${1:-CHANGELOG.md}"
  AUDIT_RELEASED_IDS=""
  [[ -f "$changelog" ]] || return 0

  # Walk the changelog; track whether we are inside a released version section
  # (a "## <semver>" heading) versus the "## Unreleased" block, and collect any
  # PREFIX-NNN work-item IDs mentioned under a released heading.
  AUDIT_RELEASED_IDS=$(awk '
    /^## / {
      released = ($0 ~ /[0-9]+\.[0-9]+\.[0-9]+/) ? 1 : 0
      next
    }
    released {
      while (match($0, /[A-Z]+-[0-9]+/)) {
        print substr($0, RSTART, RLENGTH)
        $0 = substr($0, RSTART + RLENGTH)
      }
    }
  ' "$changelog" 2>/dev/null | sort -u | tr '\n' ' ')
  return 0
}

# Extract the content of a single work item (### PREFIX-NNN: ...) — the lines
# from its header up to the next ### / ## heading or EOF.
# Usage: audit_item_content "file" "<line>"
audit_item_content() {
  local file="$1"
  local start="$2"
  awk -v start="$start" '
    NR == start { found = 1; next }
    found && /^###? / { exit }
    found { print }
  ' "$file"
}

# Pull the Status value for a work item from its content block. Handles both the
# field form ("- **Status:** Done ...") and the bold-line form
# ("**Status: Done** ..."), returning the trailing text after the status word.
# Usage: echo "$content" | audit_item_status
audit_item_status() {
  sed -nE '
    s/^- \*\*Status:\*\*[[:space:]]*//p
    s/^\*\*Status:[[:space:]]*([^*]*)\*\*/\1/p
  ' | head -1
}

# Audit a single module file, appending findings via add_result.
# Usage: audit_file "plans/modules/04-cache-semantics.aps.md"
audit_file() {
  local file="$1"
  ((TOTAL_FILES++)) || true
  FILE_TYPES["$file"]="audit"

  # --- Module-level status (header comment + metadata table) ---------------
  local mod_status_comment mod_status_table mod_status
  mod_status_comment=$(grep -m1 -oE '<!-- Status:[^>]*-->' "$file" 2>/dev/null \
    | sed -E 's/<!-- Status:[[:space:]]*//; s/[[:space:]]*-->//' || true)
  mod_status_table=$(get_status "$file")
  mod_status="${mod_status_table:-$mod_status_comment}"

  # Module claimed terminal but the metadata-table status carries a hedge
  # ("unreleased", "in progress", "done <date>, unreleased") -> overstated.
  if echo "$mod_status_comment" | grep -qiE "^$AUDIT_DONE_RE\b"; then
    if echo "$mod_status_table" | grep -qiE 'unreleased|in progress|\bdone\b'; then
      local line
      line=$(get_line_number "$file" '<!-- Status:' || true)
      add_result "$file" "warning" "A001" \
        "Module marked $mod_status_comment but table notes '$mod_status_table' — not fully shipped" "$line"
    fi
  fi

  # --- Per-work-item checks ------------------------------------------------
  local line_num header
  while IFS=: read -r line_num header; do
    [[ -z "$line_num" ]] && continue
    header=$(echo "$header" | sed 's/^[[:space:]]*//')
    local item_id
    item_id=$(echo "$header" | grep -oE '[A-Za-z]+-[0-9]+' | head -1 || true)

    local content status
    content=$(audit_item_content "$file" "$line_num")
    status=$(echo "$content" | audit_item_status || true)
    [[ -z "$status" ]] && continue

    local is_done=false is_open=false
    echo "$status" | grep -qiE "^$AUDIT_DONE_RE\b" && is_done=true
    echo "$status" | grep -qiE "^$AUDIT_OPEN_RE\b" && is_open=true

    if [[ "$is_done" == true ]]; then
      # A001 overstated: terminal status but evidence of unfinished work.
      local reasons=()
      if echo "$content" | grep -qiE '\bunreleased\b'; then
        reasons+=("status carries 'unreleased'")
      fi
      if echo "$content" | grep -qiE '\bin progress\b|\bTODO\b|\bWIP\b'; then
        reasons+=("open work note (in progress/TODO/WIP)")
      fi
      # Unchecked acceptance / checklist boxes inside the item body.
      local unchecked
      unchecked=$(echo "$content" | grep -cE '^[[:space:]]*- \[ \]' || true)
      if [[ "$unchecked" -gt 0 ]]; then
        reasons+=("$unchecked unchecked acceptance box(es)")
      fi
      if [[ ${#reasons[@]} -gt 0 ]]; then
        local joined="${reasons[0]}"
        local r
        for r in "${reasons[@]:1}"; do
          joined+="; $r"
        done
        add_result "$file" "warning" "A001" \
          "$item_id marked '$status' but evidence says not done ($joined)" "$line_num"
      fi

      # A003 stale: still flagged "unreleased" though a released CHANGELOG
      # version already names this item.
      if [[ -n "$item_id" ]] \
        && echo "$content" | grep -qiE '\bunreleased\b' \
        && echo " $AUDIT_RELEASED_IDS " | grep -qw "$item_id"; then
        add_result "$file" "warning" "A003" \
          "$item_id status says 'unreleased' but a released CHANGELOG version names it" "$line_num"
      fi
    fi

    if [[ "$is_open" == true ]]; then
      # A002 understated: pending status but a sub-note claims it shipped.
      if echo "$content" | grep -qiE "(^|[^a-z])$AUDIT_DONE_RE\b"; then
        local evidence
        evidence=$(echo "$content" \
          | grep -m1 -ioE "[^.]*$AUDIT_DONE_RE\b[^.]*" | sed 's/^[[:space:]]*//' | head -1)
        add_result "$file" "warning" "A002" \
          "$item_id marked '$status' but body notes completion ($evidence) — promote status" "$line_num"
      fi
    fi
  done <<< "$(get_work_items "$file")"

  return 0
}

# Main audit command.
cmd_audit() {
  local plan_root="plans"
  local module_filter=""
  local json_output=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_output=true
        shift
        ;;
      --plans)
        plan_root="${2:-}"
        [[ -n "$plan_root" ]] || { error "--plans requires a directory"; return 1; }
        shift 2
        ;;
      --help|-h)
        cat <<EOF
Usage: aps audit [module] [options]

Audit plan state against reality. Compares claimed module/work-item Status
against the evidence in the plan documents and the CHANGELOG, reporting:

  A001  overstated   Claimed Complete/Done but unchecked boxes, open TODOs,
                     or an 'unreleased'/'in progress' sub-note say otherwise.
  A002  understated  Claimed Proposed/Ready but a 'Done'/'Released' sub-note
                     shows it actually shipped — status not promoted.
  A003  stale        Status still says 'unreleased' though a released
                     CHANGELOG version already names the item.

Arguments:
  module      Optional module to scope to: file stem (04-cache-semantics),
              path, or module ID (CACHE). Default: all modules.

Options:
  --json      Output findings in JSON format
  --plans DIR Plan root directory (default: plans)
  --help      Show this help

Exit codes:
  0    No findings
  1    One or more findings

Examples:
  aps audit                       # Audit every module
  aps audit 04-cache-semantics    # Audit one module
  aps audit CACHE --json          # Audit by module ID, JSON output
EOF
        return 0
        ;;
      -*)
        error "Unknown option: $1"
        return 1
        ;;
      *)
        module_filter="$1"
        shift
        ;;
    esac
  done

  if [[ ! -d "$plan_root" ]]; then
    error "Path not found: $plan_root"
    return 1
  fi

  audit_load_released_ids "CHANGELOG.md"

  # Collect target module files.
  local files=()
  if [[ -n "$module_filter" ]]; then
    local resolved
    if ! resolved=$(audit_resolve_module "$plan_root" "$module_filter"); then
      error "Module not found: $module_filter"
      return 1
    fi
    files+=("$resolved")
  else
    local f
    for f in "$plan_root"/modules/*.aps.md; do
      [[ -e "$f" ]] || continue
      [[ "$(basename "$f")" == .* ]] && continue
      files+=("$f")
    done
  fi

  if [[ ${#files[@]} -eq 0 ]]; then
    error "No module files found in: $plan_root/modules"
    return 1
  fi

  local file
  for file in "${files[@]}"; do
    audit_file "$file"

    # Mark file as clean when it produced no findings (mirrors cmd_lint).
    local has_issues=false result
    for result in "${FILE_RESULTS[@]}"; do
      if [[ "$result" == "$file|"* ]]; then
        has_issues=true
        break
      fi
    done
    if [[ "$has_issues" == false ]]; then
      FILE_RESULTS+=("$file|ok|OK||")
    fi
  done

  if [[ "$json_output" == true ]]; then
    print_json_results
  else
    print_text_results
  fi

  # Advisory but gated like lint: any finding is a non-zero exit. Findings are
  # recorded as warnings, so gate on the combined finding count.
  (( TOTAL_ERRORS + TOTAL_WARNINGS > 0 )) && return 1
  return 0
}
