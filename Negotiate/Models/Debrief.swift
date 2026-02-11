import Foundation

struct DebriefScores: Codable, Equatable {
    var anchoring: Double
    var concessionDiscipline: Double
    var informationExtraction: Double
    var emotionalControl: Double
    var walkAwayTiming: Double

    var aggregate: Double {
        let total = anchoring + concessionDiscipline + informationExtraction + emotionalControl + walkAwayTiming
        return (total / 5.0).clamped(to: 0...100)
    }
}

struct DebriefReport: Codable, Equatable {
    var revealedReservationValue: Int
    var revealedTargetValue: Int
    var revealedEgoSensitivity: Double
    var revealedUrgencyCurve: Double
    var revealedAlternativesStrength: Double

    var whyItHappened: String
    var whatWorked: [String]
    var whatCostValue: [String]

    var scores: DebriefScores
    var nciDelta: Double
    var resultingNCI: Double
}

struct NCISnapshot: Codable, Equatable {
    var value: Double

    static let `default` = NCISnapshot(value: 50)
}

struct RunHistoryItem: Codable, Identifiable, Equatable {
    let id: UUID
    let scenarioID: UUID
    let scenarioTitle: String
    let listingPrice: Int
    let startedAt: Date
    let endedAt: Date
    let actions: [NegotiationAction]
    let outcome: NegotiationOutcome
    let debrief: DebriefReport
}
