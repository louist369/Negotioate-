import Foundation

enum Region: String, Codable, CaseIterable, Identifiable {
    case london
    case manchester
    case birmingham
    case bristol
    case edinburgh

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }
}

enum PropertyType: String, Codable, CaseIterable, Identifiable {
    case flat
    case terrace
    case semiDetached
    case detached

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .semiDetached:
            return "Semi-Detached"
        default:
            return rawValue.capitalized
        }
    }
}

enum MarketRegime: String, Codable, CaseIterable, Identifiable {
    case hot
    case neutral
    case cold

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }
}

struct KnownFacts: Codable, Equatable {
    var daysOnMarket: Int
    var chainStatusKnown: Bool
    var hasCompetingViewingsSignal: Bool
}

struct Scenario: Codable, Equatable, Identifiable {
    var id: UUID
    var domainPackID: String
    var addressLabel: String
    var listingPrice: Int
    var region: Region
    var propertyType: PropertyType
    var knownFacts: KnownFacts

    var storyPrompt: String
    var objective: String

    var sellerArchetype: SellerArchetype
    var marketRegime: MarketRegime
    var hiddenState: HiddenState
    var eventWeights: EventWeights
}
