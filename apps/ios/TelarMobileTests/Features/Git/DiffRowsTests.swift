import Testing
@testable import TelarMobile

@Suite struct DiffRowsTests {
    @Test func aPathSplitsIntoItsNameAndFolder() {
        #expect(splitPath("apps/ios/Theme.swift") == ("Theme.swift", "apps/ios"))
        #expect(splitPath("README.md") == ("README.md", nil))
    }

    @Test func theStatBarShowsBothSidesOfAMixedChange() {
        #expect(diffStatBlocks(added: 0, removed: 0) == (0, 0))
        #expect(diffStatBlocks(added: 10, removed: 0) == (5, 0))
        #expect(diffStatBlocks(added: 0, removed: 3) == (0, 5))
        #expect(diffStatBlocks(added: 1, removed: 999) == (1, 4))
        #expect(diffStatBlocks(added: 999, removed: 1) == (4, 1))
        #expect(diffStatBlocks(added: 72, removed: 72) == (3, 2))
    }
}
