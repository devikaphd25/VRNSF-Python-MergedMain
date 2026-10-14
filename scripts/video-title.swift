import Foundation
import AVFoundation
import Vision
let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
var titles: [String] = []
for second in [1.0, 3.0] {
    guard let image = try? generator.copyCGImage(at: CMTime(seconds: second, preferredTimescale: 600), actualTime: nil) else { continue }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    try? VNImageRequestHandler(cgImage: image).perform([request])
    let candidates = (request.results ?? []).filter {
        $0.boundingBox.midY > 0.45 && $0.boundingBox.height > 0.035 && ($0.topCandidates(1).first?.confidence ?? 0) > 0.9
    }.sorted { $0.boundingBox.height > $1.boundingBox.height }
    if let value = candidates.first?.topCandidates(1).first?.string, value.count >= 5, value.count <= 100 { titles.append(value) }
}
if titles.count == 2 && titles[0] == titles[1] { print(titles[0]) }
