import Foundation

struct ModelChoice: Equatable {
    var driver: String
    var model: String?
    var effort: String?
    var fastMode: Bool?
    var serviceTier: String? = nil
    var ultracode: Bool? = nil

    var isTouched: Bool {
        model != nil || effort != nil || fastMode != nil || serviceTier != nil || ultracode != nil
    }
}
