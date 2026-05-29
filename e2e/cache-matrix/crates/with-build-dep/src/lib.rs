pub fn build_dep_marker() -> &'static str {
    "built"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_marker() {
        assert_eq!(build_dep_marker(), "built");
    }
}
