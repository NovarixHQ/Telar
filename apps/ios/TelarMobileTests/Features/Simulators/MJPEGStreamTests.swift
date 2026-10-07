import Foundation
import Network
import Testing
import UIKit
@testable import TelarMobile

private final class MultipartServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "mjpeg-server")
    private var connections: [NWConnection] = []

    init(_ body: Data) throws {
        listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            connections.append(connection)
            connection.start(queue: queue)
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { _, _, _, _ in
                let head = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nConnection: keep-alive\r\n\r\n"
                connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in })
            }
        }
    }

    func start() async -> URL {
        let ready = AsyncStream.makeStream(of: UInt16.self)
        listener.stateUpdateHandler = { [listener] state in
            switch state {
            case .ready: ready.continuation.yield(listener.port?.rawValue ?? 0)
            case .failed, .cancelled: ready.continuation.yield(0)
            default: break
            }
        }
        listener.start(queue: queue)
        let port = await ready.stream.first { _ in true } ?? 0
        return URL(string: "http://127.0.0.1:\(port)/stream.mjpeg")!
    }

    func stop() {
        listener.cancel()
        queue.sync { connections.forEach { $0.cancel() } }
    }
}

@MainActor @Suite(.timeLimit(.minutes(1))) struct MJPEGStreamTests {
    private func jpeg(_ size: CGSize) -> Data {
        UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }())
            .jpegData(withCompressionQuality: 0.8) { context in
                UIColor.red.setFill()
                context.fill(CGRect(origin: .zero, size: size))
            }
    }

    private func part(_ jpeg: Data, length: Bool) -> Data {
        var header = "--frame\r\nContent-Type: image/jpeg\r\n"
        if length { header += "Content-Length: \(jpeg.count)\r\n" }
        return Data((header + "\r\n").utf8) + jpeg + Data("\r\n".utf8)
    }

    private func firstFrame(_ body: Data) async throws -> CGSize? {
        let server = try MultipartServer(body)
        let url = await server.start()
        let frames = AsyncStream.makeStream(of: CGSize?.self)
        let stream = MJPEGStream(onFrame: { frames.continuation.yield($0.size) }, onEnd: { _ in frames.continuation.yield(nil) })
        stream.start(URLRequest(url: url, timeoutInterval: 10))
        defer {
            stream.stop()
            server.stop()
        }
        return await frames.stream.first { _ in true } ?? nil
    }

    @Test func aStreamedFrameReachesTheViewer() async throws {
        let size = CGSize(width: 6, height: 10)
        let body = part(jpeg(size), length: true) + part(jpeg(size), length: true)
        #expect(try await firstFrame(body) == size)
    }

    @Test func aFrameWithoutALengthIsShownWhenTheNextOneBegins() async throws {
        let size = CGSize(width: 8, height: 4)
        let body = part(jpeg(size), length: false) + part(jpeg(size), length: false)
        #expect(try await firstFrame(body) == size)
    }
}
