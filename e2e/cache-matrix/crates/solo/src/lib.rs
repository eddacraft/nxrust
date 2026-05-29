pub fn solo_value() -> u32 {
    42
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_value() {
        assert_eq!(solo_value(), 42);
    }
}
