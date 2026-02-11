import Foundation

enum CompletionSpeed: String, Codable, CaseIterable, Identifiable {
    case flexible
    case normal
    case fast

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }

    var sellerUtilityBias: Double {
        switch self {
        case .fast: return 0.18
        case .normal: return 0.0
        case .flexible: return -0.08
        }
    }
}

enum IncludedFixtures: String, Codable, CaseIterable, Identifiable {
    case none
    case some
    case all

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }

    var sellerUtilityBias: Double {
        switch self {
        case .none: return 0.14
        case .some: return 0.03
        case .all: return -0.13
        }
    }
}

struct Terms: Codable, Equatable {
    var completionSpeed: CompletionSpeed
    var includedFixtures: IncludedFixtures
    var conditionalOnSurvey: Bool

    static let `default` = Terms(
        completionSpeed: .normal,
        includedFixtures: .some,
        conditionalOnSurvey: true
    )

    var sellerUtility: Double {
        var value = completionSpeed.sellerUtilityBias + includedFixtures.sellerUtilityBias
        value += conditionalOnSurvey ? -0.10 : 0.08
        return value
    }

    var summary: String {
        let surveyLabel = conditionalOnSurvey ? "Survey conditional" : "No survey condition"
        return "\(completionSpeed.displayName) completion, fixtures: \(includedFixtures.displayName), \(surveyLabel)"
    }
}
