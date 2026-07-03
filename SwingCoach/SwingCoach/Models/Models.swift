import Foundation

enum Handedness: String, Codable, CaseIterable, Identifiable {
    case right = "Right-handed"
    case left = "Left-handed"
    var id: String { rawValue }
}

enum Club: String, Codable, CaseIterable, Identifiable {
    case driver = "Driver"
    case fairwayWood = "Fairway wood"
    case hybrid = "Hybrid"
    case longIron = "Long iron (2–4)"
    case midIron = "Mid iron (5–7)"
    case shortIron = "Short iron (8–9)"
    case wedge = "Wedge"
    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .driver: return "D"
        case .fairwayWood: return "W"
        case .hybrid: return "H"
        case .longIron: return "4i"
        case .midIron: return "6i"
        case .shortIron: return "9i"
        case .wedge: return "PW"
        }
    }
}

/// Where the ball started relative to your target line, as you saw it.
enum StartLine: String, Codable, CaseIterable, Identifiable {
    case left = "Left of target"
    case straight = "At target"
    case right = "Right of target"
    var id: String { rawValue }

    var short: String {
        switch self {
        case .left: return "Left"
        case .straight: return "Straight"
        case .right: return "Right"
        }
    }
}

/// Curve is described in golfer's terms, which are already relative to your
/// handedness — a slice curves right for a righty and left for a lefty.
enum Curve: String, Codable, CaseIterable, Identifiable {
    case hook = "Big hook"
    case draw = "Draw"
    case straight = "Straight"
    case fade = "Fade"
    case slice = "Big slice"
    var id: String { rawValue }
}

enum Contact: String, Codable, CaseIterable, Identifiable {
    case flush = "Flush"
    case thin = "Thin"
    case fat = "Fat / chunked"
    case topped = "Topped"
    case toe = "Off the toe"
    case heel = "Off the heel"
    case shank = "Shank"
    var id: String { rawValue }
}

enum Trajectory: String, Codable, CaseIterable, Identifiable {
    case low = "Low"
    case normal = "Normal"
    case high = "Ballooned / high"
    var id: String { rawValue }
}

struct Shot: Codable, Identifiable {
    var id = UUID()
    var date = Date()
    var club: Club = .driver
    var startLine: StartLine = .straight
    var curve: Curve = .straight
    var contact: Contact = .flush
    var trajectory: Trajectory = .normal
    var note: String = ""

    /// One-line description used in history lists, e.g. "Driver — starts left, big slice".
    var summary: String {
        var parts: [String] = []
        if contact != .flush { parts.append(contact.rawValue.lowercased()) }
        if startLine != .straight { parts.append("starts \(startLine.short.lowercased())") }
        if curve != .straight { parts.append(curve.rawValue.lowercased()) }
        if parts.isEmpty { parts.append("flush and straight") }
        return "\(club.rawValue) — \(parts.joined(separator: ", "))"
    }
}

struct Drill: Identifiable {
    var id: String { name }
    let name: String
    let howTo: String
}

struct Diagnosis {
    let headline: String
    /// What the ball flight tells us physically happened at impact.
    let whatHappened: String
    /// The most likely swing faults, most likely first.
    let likelyCauses: [String]
    /// What to feel or change.
    let fixes: [String]
    let drills: [Drill]
    /// True for the "flush and straight" case.
    let isPositive: Bool
}
