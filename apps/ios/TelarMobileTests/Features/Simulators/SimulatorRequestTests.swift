import Foundation
import Testing
@testable import TelarMobile

struct SimulatorRequestTests {
    private let api = HTTPEngineAPI(baseURL: URL(string: "http://mac.local:3000")!, deviceToken: "tlr_test")

    private func json(_ request: URLRequest) throws -> [String: Any] {
        let body = try #require(request.httpBody)
        let object = try JSONSerialization.jsonObject(with: body)
        return try #require(object as? [String: Any])
    }

    @Test func inputPostsEventsToTheCockpitWithTheDeviceToken() throws {
        let request = try api.simulatorInputRequest("ABC-123", events: [
            .touch(.begin, x: 0.25, y: 0.5),
            .button(.appSwitcher),
            .orientation(.landscapeLeft),
        ])
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "http://mac.local:3000/api/simulators/ABC-123/input")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tlr_test")
        #expect(request.value(forHTTPHeaderField: "content-type") == "application/json")
        let body = try json(request)
        let events = try #require(body["events"] as? [[String: Any]])
        #expect(events.count == 3)
        #expect(events[0]["type"] as? String == "touch")
        #expect(events[0]["phase"] as? String == "begin")
        #expect(events[0]["x"] as? Double == 0.25)
        #expect(events[0]["y"] as? Double == 0.5)
        #expect(events[1]["type"] as? String == "button")
        #expect(events[1]["button"] as? String == "app_switcher")
        #expect(events[2]["type"] as? String == "orientation")
        #expect(events[2]["orientation"] as? String == "landscape_left")
    }

    @Test func theStreamIsTheHubMJPEGRouteBehindTheCockpit() {
        let request = api.simulatorStreamRequest("ABC-123", base: nil)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "http://mac.local:3000/api/simulators/hub/vendor/serve-sim/helper/ABC-123/stream.mjpeg")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tlr_test")
    }

    @Test func theStreamMovesToAFailoverAddress() {
        let request = api.simulatorStreamRequest("ABC-123", base: URL(string: "http://100.64.0.2:3000")!)
        #expect(request.url?.absoluteString == "http://100.64.0.2:3000/api/simulators/hub/vendor/serve-sim/helper/ABC-123/stream.mjpeg")
    }

    @Test func coalescingKeepsTheLastMoveOfEachRunAndEveryBeginAndEnd() {
        let events: [SimulatorInput] = [
            .touch(.begin, x: 0, y: 0),
            .touch(.move, x: 0.1, y: 0),
            .touch(.move, x: 0.2, y: 0),
            .touch(.move, x: 0.3, y: 0),
            .touch(.end, x: 0.3, y: 0),
            .button(.home),
            .touch(.move, x: 0.9, y: 0.9),
        ]
        #expect(SimulatorInput.coalesce(events) == [
            .touch(.begin, x: 0, y: 0),
            .touch(.move, x: 0.3, y: 0),
            .touch(.end, x: 0.3, y: 0),
            .button(.home),
            .touch(.move, x: 0.9, y: 0.9),
        ])
    }

    @Test func rotationCyclesThroughTheFourOrientations() {
        #expect(SimulatorOrientation.portrait.next == .landscapeLeft)
        #expect(SimulatorOrientation.landscapeLeft.next == .portraitUpsideDown)
        #expect(SimulatorOrientation.portraitUpsideDown.next == .landscapeRight)
        #expect(SimulatorOrientation.landscapeRight.next == .portrait)
    }

    @Test func onlyBootedIOSSimulatorsCanBeViewed() throws {
        let body = #"""
        {"status":"ready","hub":{"requiredVersion":"0.12.0","installedVersions":[],"runningVersion":"0.12.0"},
         "platforms":[{"platform":"ios","available":true},{"platform":"android","available":false,"reason":"No SDK"}],
         "simulators":[
          {"id":"A","platform":"ios","name":"iPhone 17","version":"26.0","booted":true,"physical":false},
          {"id":"B","platform":"ios","name":"iPad","version":"26.0","booted":false,"physical":false},
          {"id":"C","platform":"android","name":"Pixel","version":"15","booted":true,"physical":false}],
         "errors":[]}
        """#
        let state = try JSONDecoder().decode(SimulatorsState.self, from: Data(body.utf8))
        #expect(state.viewable.map(\.id) == ["A"])
        #expect(state.platforms.last?.reason == "No SDK")
    }
}
