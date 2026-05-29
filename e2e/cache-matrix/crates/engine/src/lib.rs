pub fn greeting() -> String {
    "hello from engine".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greets() {
        assert_eq!(greeting(), "hello from engine");
    }
}
