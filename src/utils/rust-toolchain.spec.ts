import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOLCHAIN_SENTINEL,
  resolveToolchain,
  validateChannelLiteral,
} from './rust-toolchain';

describe('resolveToolchain', () => {
  let workspaceRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'nxrust-toolchain-'));
    projectRoot = join(workspaceRoot, 'crates', 'demo');
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('reads a workspace-root rust-toolchain.toml', () => {
    writeFileSync(
      join(workspaceRoot, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "stable"\n',
    );

    const result = resolveToolchain({ projectRoot, workspaceRoot });

    expect(result.channel).toBe('stable');
    expect(result.source).toBe('rust-toolchain.toml');
    expect(result.origin).toBe(join(workspaceRoot, 'rust-toolchain.toml'));
  });

  it('prefers a project-root rust-toolchain.toml over the workspace-root one', () => {
    writeFileSync(
      join(workspaceRoot, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "stable"\n',
    );
    writeFileSync(
      join(projectRoot, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "nightly"\n',
    );

    const result = resolveToolchain({ projectRoot, workspaceRoot });

    expect(result.channel).toBe('nightly');
    expect(result.origin).toBe(join(projectRoot, 'rust-toolchain.toml'));
  });

  it('prefers .toml over legacy rust-toolchain at the same depth', () => {
    writeFileSync(
      join(projectRoot, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "1.83.0"\n',
    );
    writeFileSync(join(projectRoot, 'rust-toolchain'), 'nightly\n');

    const result = resolveToolchain({ projectRoot, workspaceRoot });

    expect(result.channel).toBe('1.83.0');
    expect(result.source).toBe('rust-toolchain.toml');
  });

  it('reads the legacy single-line rust-toolchain file when no .toml exists', () => {
    writeFileSync(join(workspaceRoot, 'rust-toolchain'), 'beta\n');

    const result = resolveToolchain({ projectRoot, workspaceRoot });

    expect(result.channel).toBe('beta');
    expect(result.source).toBe('rust-toolchain');
    expect(result.origin).toBe(join(workspaceRoot, 'rust-toolchain'));
  });

  it('trims whitespace around the legacy single-line channel', () => {
    writeFileSync(join(workspaceRoot, 'rust-toolchain'), '  nightly  \n');

    const result = resolveToolchain({ projectRoot, workspaceRoot });

    expect(result.channel).toBe('nightly');
  });

  it('returns the default sentinel when no toolchain file exists anywhere', () => {
    const result = resolveToolchain({ projectRoot, workspaceRoot });

    expect(result.channel).toBe(DEFAULT_TOOLCHAIN_SENTINEL);
    expect(result.source).toBe('default');
    expect(result.origin).toBeUndefined();
  });

  it('throws on malformed rust-toolchain.toml with the file path in the message', () => {
    const path = join(workspaceRoot, 'rust-toolchain.toml');
    writeFileSync(path, '[toolchain\nchannel = "stable"\n');

    expect(() => resolveToolchain({ projectRoot, workspaceRoot })).toThrow(
      /rust-toolchain\.toml/,
    );
  });

  it('throws when rust-toolchain.toml lacks the [toolchain] table', () => {
    writeFileSync(join(workspaceRoot, 'rust-toolchain.toml'), '');

    expect(() => resolveToolchain({ projectRoot, workspaceRoot })).toThrow(
      /\[toolchain\]/,
    );
  });

  it('throws when [toolchain] has no channel field', () => {
    writeFileSync(
      join(workspaceRoot, 'rust-toolchain.toml'),
      '[toolchain]\ncomponents = ["rustfmt"]\n',
    );

    expect(() => resolveToolchain({ projectRoot, workspaceRoot })).toThrow(
      /channel/,
    );
  });

  it('throws when legacy rust-toolchain is empty', () => {
    writeFileSync(join(workspaceRoot, 'rust-toolchain'), '');

    expect(() => resolveToolchain({ projectRoot, workspaceRoot })).toThrow(
      /empty/,
    );
  });

  it('throws when legacy rust-toolchain contains only whitespace', () => {
    writeFileSync(join(workspaceRoot, 'rust-toolchain'), '   \n\n');

    expect(() => resolveToolchain({ projectRoot, workspaceRoot })).toThrow(
      /empty/,
    );
  });

  it('accepts a fully-qualified channel triple', () => {
    writeFileSync(
      join(workspaceRoot, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "nightly-2024-01-15-x86_64-unknown-linux-gnu"\n',
    );

    const result = resolveToolchain({ projectRoot, workspaceRoot });

    expect(result.channel).toBe('nightly-2024-01-15-x86_64-unknown-linux-gnu');
  });

  it('accepts a custom linked toolchain name', () => {
    writeFileSync(
      join(workspaceRoot, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "my-custom-1"\n',
    );

    const result = resolveToolchain({ projectRoot, workspaceRoot });

    expect(result.channel).toBe('my-custom-1');
  });

  it('throws on a channel literal containing a space', () => {
    writeFileSync(
      join(workspaceRoot, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "my channel"\n',
    );

    expect(() => resolveToolchain({ projectRoot, workspaceRoot })).toThrow(
      /invalid toolchain literal/i,
    );
  });

  it('throws on a channel literal containing shell-meta', () => {
    writeFileSync(
      join(workspaceRoot, 'rust-toolchain.toml'),
      '[toolchain]\nchannel = "a;b"\n',
    );

    expect(() => resolveToolchain({ projectRoot, workspaceRoot })).toThrow(
      /invalid toolchain literal/i,
    );
  });

  it('uses the workspace toolchain when projectRoot is outside workspaceRoot', () => {
    // projectRoot is a sibling of workspaceRoot, not under it. The walk-up
    // safety guard should refuse to ascend past workspaceRoot.
    const siblingRoot = mkdtempSync(join(tmpdir(), 'nxrust-sibling-'));
    try {
      writeFileSync(
        join(workspaceRoot, 'rust-toolchain.toml'),
        '[toolchain]\nchannel = "stable"\n',
      );

      const result = resolveToolchain({
        projectRoot: siblingRoot,
        workspaceRoot,
      });

      // workspaceRoot's file is still seen because the walk falls back to
      // stop-only, but it must not invent intermediate dirs above the stop.
      expect(result.source).toBe('rust-toolchain.toml');
      expect(result.origin).toBe(join(workspaceRoot, 'rust-toolchain.toml'));
    } finally {
      rmSync(siblingRoot, { recursive: true, force: true });
    }
  });

  describe('D-TC2 override hierarchy (TOOLCHAIN-002)', () => {
    it('projectJsonToolchain wins over the file branch', () => {
      writeFileSync(
        join(workspaceRoot, 'rust-toolchain.toml'),
        '[toolchain]\nchannel = "stable"\n',
      );

      const result = resolveToolchain({
        projectRoot,
        workspaceRoot,
        projectJsonToolchain: 'nightly',
      });

      expect(result).toEqual({ channel: 'nightly', source: 'project.json' });
    });

    it('cargoMetadataTargetToolchain wins over the file branch', () => {
      writeFileSync(
        join(workspaceRoot, 'rust-toolchain.toml'),
        '[toolchain]\nchannel = "stable"\n',
      );

      const result = resolveToolchain({
        projectRoot,
        workspaceRoot,
        cargoMetadataTargetToolchain: 'beta',
      });

      expect(result).toEqual({
        channel: 'beta',
        source: 'package.metadata.nxrust.targets',
      });
    });

    it('cargoMetadataPackageToolchain wins over the file branch', () => {
      writeFileSync(
        join(workspaceRoot, 'rust-toolchain.toml'),
        '[toolchain]\nchannel = "stable"\n',
      );

      const result = resolveToolchain({
        projectRoot,
        workspaceRoot,
        cargoMetadataPackageToolchain: '1.83.0',
      });

      expect(result).toEqual({
        channel: '1.83.0',
        source: 'package.metadata.nxrust',
      });
    });

    it('projectJsonToolchain wins when all three overrides are set', () => {
      const result = resolveToolchain({
        projectRoot,
        workspaceRoot,
        projectJsonToolchain: 'nightly',
        cargoMetadataTargetToolchain: 'beta',
        cargoMetadataPackageToolchain: '1.83.0',
      });

      expect(result.channel).toBe('nightly');
      expect(result.source).toBe('project.json');
    });

    it('cargoMetadataTargetToolchain wins over cargoMetadataPackageToolchain', () => {
      const result = resolveToolchain({
        projectRoot,
        workspaceRoot,
        cargoMetadataTargetToolchain: 'beta',
        cargoMetadataPackageToolchain: '1.83.0',
      });

      expect(result.channel).toBe('beta');
      expect(result.source).toBe('package.metadata.nxrust.targets');
    });

    it('cargoMetadataPackageToolchain is used when no file exists and no higher-priority override is set', () => {
      const result = resolveToolchain({
        projectRoot,
        workspaceRoot,
        cargoMetadataPackageToolchain: 'nightly',
      });

      expect(result).toEqual({
        channel: 'nightly',
        source: 'package.metadata.nxrust',
      });
    });

    it('falls through to the file branch when no overrides are passed', () => {
      writeFileSync(
        join(workspaceRoot, 'rust-toolchain.toml'),
        '[toolchain]\nchannel = "stable"\n',
      );

      const result = resolveToolchain({ projectRoot, workspaceRoot });

      expect(result.source).toBe('rust-toolchain.toml');
      expect(result.channel).toBe('stable');
    });

    it('throws with source context when projectJsonToolchain contains shell-meta', () => {
      expect(() =>
        resolveToolchain({
          projectRoot,
          workspaceRoot,
          projectJsonToolchain: 'evil;rm -rf /',
        }),
      ).toThrow(/invalid toolchain literal from projectJsonToolchain/i);
    });

    it('throws with source context when cargoMetadataTargetToolchain contains whitespace', () => {
      expect(() =>
        resolveToolchain({
          projectRoot,
          workspaceRoot,
          cargoMetadataTargetToolchain: 'my channel',
        }),
      ).toThrow(/invalid toolchain literal from cargoMetadataTargetToolchain/i);
    });

    it('throws with source context when cargoMetadataPackageToolchain is empty', () => {
      expect(() =>
        resolveToolchain({
          projectRoot,
          workspaceRoot,
          cargoMetadataPackageToolchain: '',
        }),
      ).toThrow(/invalid toolchain literal from cargoMetadataPackageToolchain/i);
    });

    it('accepts a fully-qualified channel triple as projectJsonToolchain', () => {
      const result = resolveToolchain({
        projectRoot,
        workspaceRoot,
        projectJsonToolchain: 'nightly-2024-01-15-x86_64-unknown-linux-gnu',
      });

      expect(result.channel).toBe(
        'nightly-2024-01-15-x86_64-unknown-linux-gnu',
      );
      expect(result.source).toBe('project.json');
    });

    it('overrides take precedence even when file is unreadable would have thrown', () => {
      // Malformed file would normally throw — but if a higher-priority
      // override is set, the file is never read in the first place.
      writeFileSync(
        join(workspaceRoot, 'rust-toolchain.toml'),
        '[toolchain\nchannel = "broken"',
      );

      const result = resolveToolchain({
        projectRoot,
        workspaceRoot,
        projectJsonToolchain: 'stable',
      });

      expect(result.channel).toBe('stable');
      expect(result.source).toBe('project.json');
    });
  });
});

describe('validateChannelLiteral', () => {
  it.each(['stable', 'nightly', 'beta', '1.83.0', 'nightly-2024-01-15', 'my-custom_1+abc'])(
    'accepts %s',
    (channel) => {
      expect(() => validateChannelLiteral(channel)).not.toThrow();
    },
  );

  it.each(['a b', 'a;b', 'a$b', 'a/b', 'a\\b', 'a&b', 'a|b', '', '   '])(
    'rejects %s',
    (channel) => {
      expect(() => validateChannelLiteral(channel)).toThrow();
    },
  );
});
