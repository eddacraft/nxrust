pub fn doubled(x: u32) -> u32 {
    x * 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_dev_dep_value() {
        // `solo` is a dev-dependency: only visible to the test build.
        assert_eq!(doubled(solo::solo_value()), 84);
    }
}
