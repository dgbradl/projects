import Foundation

/// Optional AI coaching via the Anthropic API. Only used when the user has
/// pasted an API key into Settings — the built-in engine works fully offline.
enum AICoach {

    enum AIError: LocalizedError {
        case badResponse(String)
        case refused

        var errorDescription: String? {
            switch self {
            case .badResponse(let detail): return "The AI request failed: \(detail)"
            case .refused: return "The AI declined to answer this request."
            }
        }
    }

    static func advice(for shot: Shot, handedness: Handedness, apiKey: String) async throws -> String {
        let description = """
        Golfer: \(handedness.rawValue).
        Club: \(shot.club.rawValue).
        Contact: \(shot.contact.rawValue).
        Start line: \(shot.startLine.rawValue).
        Curve: \(shot.curve.rawValue).
        Trajectory: \(shot.trajectory.rawValue).
        \(shot.note.isEmpty ? "" : "Golfer's own description: \(shot.note)")
        """

        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.timeoutInterval = 120

        let body: [String: Any] = [
            "model": "claude-opus-4-8",
            "max_tokens": 1024,
            "system": """
            You are a friendly, expert golf instructor. The golfer will describe one shot. \
            Give practical, encouraging advice about the most likely swing cause and ONE \
            specific thing to work on, with a drill. Be concise (under 200 words), use \
            plain language, and never blame the golfer.
            """,
            "messages": [
                ["role": "user", "content": description]
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw AIError.badResponse("no HTTP response")
        }
        guard http.statusCode == 200 else {
            let apiMessage = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { $0["error"] as? [String: Any] }
                .flatMap { $0["message"] as? String }
            throw AIError.badResponse(apiMessage ?? "HTTP \(http.statusCode)")
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIError.badResponse("unreadable response body")
        }
        if json["stop_reason"] as? String == "refusal" {
            throw AIError.refused
        }
        guard let content = json["content"] as? [[String: Any]] else {
            throw AIError.badResponse("missing content")
        }
        // Content is a list of typed blocks; collect the text ones.
        let text = content
            .filter { $0["type"] as? String == "text" }
            .compactMap { $0["text"] as? String }
            .joined(separator: "\n")

        guard !text.isEmpty else { throw AIError.badResponse("empty answer") }
        return text
    }
}
