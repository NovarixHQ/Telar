import UIKit

final class MJPEGStream: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    enum Ending: Sendable {
        case failed(Error)
        case status(Int, Data)
        case closed
    }

    private let onFrame: @MainActor (UIImage) -> Void
    private let onEnd: @MainActor (Ending) -> Void
    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInteractive
        return queue
    }()
    private var session: URLSession?
    private var parser = MJPEGParser()
    private var status = 200
    private var errorBody = Data()
    private var decoding = false

    init(onFrame: @escaping @MainActor (UIImage) -> Void, onEnd: @escaping @MainActor (Ending) -> Void) {
        self.onFrame = onFrame
        self.onEnd = onEnd
    }

    func start(_ request: URLRequest) {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = request.timeoutInterval
        config.waitsForConnectivity = false
        let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
        self.session = session
        session.dataTask(with: request).resume()
    }

    func stop() {
        session?.invalidateAndCancel()
        session = nil
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let http = response as? HTTPURLResponse
        status = http?.statusCode ?? 0
        parser = MJPEGParser(contentType: http?.value(forHTTPHeaderField: "content-type"))
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard (200..<300).contains(status) else {
            errorBody.append(data.prefix(4096))
            return
        }
        guard let newest = parser.append(data).last, !decoding else { return }
        decoding = true
        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            let image = UIImage(data: newest)?.preparingForDisplay()
            self?.queue.addOperation { self?.decoding = false }
            guard let image, let self else { return }
            let deliver = self.onFrame
            Task { @MainActor in deliver(image) }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let ending: Ending
        if let error {
            if (error as? URLError)?.code == .cancelled { return }
            ending = .failed(error)
        } else if !(200..<300).contains(status) {
            ending = .status(status, errorBody)
        } else {
            ending = .closed
        }
        let report = onEnd
        Task { @MainActor in report(ending) }
    }
}
