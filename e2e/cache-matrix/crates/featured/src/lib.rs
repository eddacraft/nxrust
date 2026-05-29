#[cfg(feature = "alpha")]
pub fn alpha() -> &'static str {
    "alpha"
}

#[cfg(feature = "beta")]
pub fn beta() -> &'static str {
    "beta"
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(feature = "alpha")]
    fn alpha_enabled_by_default() {
        assert_eq!(super::alpha(), "alpha");
    }
}
