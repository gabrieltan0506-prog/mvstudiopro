import AppKit
import Foundation
import Vision

struct OcrLine: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OcrResult: Codable {
    let width: Int
    let height: Int
    let lines: [OcrLine]
}

let cliArgs = Array(CommandLine.arguments.dropFirst())
let batchMode = cliArgs.first == "--batch"
let imagePaths = batchMode ? Array(cliArgs.dropFirst()) : cliArgs
guard !imagePaths.isEmpty, batchMode || imagePaths.count == 1 else {
    FileHandle.standardError.write(Data("usage: macos-weixin-channels-ocr.swift [--batch] <screenshot.png>...\n".utf8))
    exit(2)
}

func recognize(path: String) throws -> OcrResult {
    let imageUrl = URL(fileURLWithPath: path)
    guard let nsImage = NSImage(contentsOf: imageUrl),
          let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw NSError(domain: "weixin-ocr", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot_read_image:\(path)"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = batchMode ? .fast : .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = !batchMode
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    let observations = (request.results ?? []).compactMap { observation -> OcrLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OcrLine(
            text: candidate.string,
            confidence: candidate.confidence,
            x: box.origin.x,
            y: box.origin.y,
            width: box.size.width,
            height: box.size.height
        )
    }
    return OcrResult(width: cgImage.width, height: cgImage.height, lines: observations)
}

let results = try imagePaths.map(recognize)
let encoded = batchMode
    ? try JSONEncoder().encode(results)
    : try JSONEncoder().encode(results[0])
FileHandle.standardOutput.write(encoded)
