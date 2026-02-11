import Foundation

enum SellerArchetype: String, Codable, CaseIterable, Identifiable {
    case overpricer
    case hardliner
    case panicked
    case investor
    case emotional

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .overpricer: return "Overpricer"
        case .hardliner: return "Hardliner"
        case .panicked: return "Panicked"
        case .investor: return "Investor"
        case .emotional: return "Emotional"
        }
    }

    var profile: ArchetypeProfile {
        switch self {
        case .overpricer:
            return ArchetypeProfile(
                wPrice: 0.38,
                wTerms: 0.16,
                wTrust: 0.11,
                wEgo: 0.17,
                wUrgency: 0.12,
                wFatigue: 0.06,
                baseAcceptThreshold: 0.62,
                baseCounterBand: 0.16,
                baseWithdrawThreshold: 0.17,
                askTrustDelta: 0.03,
                disrespectPenalty: 0.12,
                callbackBaseProbability: 0.43,
                urgencyAcceleration: 0.12
            )
        case .hardliner:
            return ArchetypeProfile(
                wPrice: 0.44,
                wTerms: 0.17,
                wTrust: 0.06,
                wEgo: 0.22,
                wUrgency: 0.07,
                wFatigue: 0.04,
                baseAcceptThreshold: 0.72,
                baseCounterBand: 0.10,
                baseWithdrawThreshold: 0.24,
                askTrustDelta: 0.01,
                disrespectPenalty: 0.18,
                callbackBaseProbability: 0.18,
                urgencyAcceleration: 0.06
            )
        case .panicked:
            return ArchetypeProfile(
                wPrice: 0.28,
                wTerms: 0.12,
                wTrust: 0.09,
                wEgo: 0.08,
                wUrgency: 0.31,
                wFatigue: 0.12,
                baseAcceptThreshold: 0.49,
                baseCounterBand: 0.22,
                baseWithdrawThreshold: 0.10,
                askTrustDelta: 0.04,
                disrespectPenalty: 0.08,
                callbackBaseProbability: 0.65,
                urgencyAcceleration: 0.20
            )
        case .investor:
            return ArchetypeProfile(
                wPrice: 0.50,
                wTerms: 0.25,
                wTrust: 0.03,
                wEgo: 0.06,
                wUrgency: 0.12,
                wFatigue: 0.04,
                baseAcceptThreshold: 0.60,
                baseCounterBand: 0.15,
                baseWithdrawThreshold: 0.19,
                askTrustDelta: 0.02,
                disrespectPenalty: 0.07,
                callbackBaseProbability: 0.35,
                urgencyAcceleration: 0.11
            )
        case .emotional:
            return ArchetypeProfile(
                wPrice: 0.31,
                wTerms: 0.14,
                wTrust: 0.24,
                wEgo: 0.17,
                wUrgency: 0.08,
                wFatigue: 0.06,
                baseAcceptThreshold: 0.58,
                baseCounterBand: 0.18,
                baseWithdrawThreshold: 0.21,
                askTrustDelta: 0.05,
                disrespectPenalty: 0.15,
                callbackBaseProbability: 0.39,
                urgencyAcceleration: 0.09
            )
        }
    }
}

struct ArchetypeProfile: Codable, Equatable {
    let wPrice: Double
    let wTerms: Double
    let wTrust: Double
    let wEgo: Double
    let wUrgency: Double
    let wFatigue: Double

    let baseAcceptThreshold: Double
    let baseCounterBand: Double
    let baseWithdrawThreshold: Double

    let askTrustDelta: Double
    let disrespectPenalty: Double
    let callbackBaseProbability: Double
    let urgencyAcceleration: Double
}

enum SellerMood: String, Codable, CaseIterable {
    case firm = "Firm"
    case warming = "Warming"
    case irritated = "Irritated"
    case anxious = "Anxious"
    case cold = "Cold"
    case offended = "Offended"

    var sentiment: MoodSentiment {
        switch self {
        case .warming: return .positive
        case .anxious, .firm: return .neutral
        case .irritated, .cold, .offended: return .negative
        }
    }
}

enum MoodSentiment: String, Codable {
    case positive
    case neutral
    case negative
}
