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

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: macos-weixin-channels-ocr.swift <screenshot.png>\n".utf8))
    exit(2)
}

let imageUrl = URL(fileURLWithPath: CommandLine.arguments[1])
guard let nsImage = NSImage(contentsOf: imageUrl),
      let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write(Data("cannot_read_image\n".utf8))
    exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
request.usesLanguageCorrection = true
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

let result = OcrResult(width: cgImage.width, height: cgImage.height, lines: observations)
let encoded = try JSONEncoder().encode(result)
FileHandle.standardOutput.write(encoded)
