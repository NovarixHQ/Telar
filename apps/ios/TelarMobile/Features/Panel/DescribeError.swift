import Foundation

func describe(_ error: Error) -> String {
    (error as? EngineAPIError)?.errorDescription ?? error.localizedDescription
}
