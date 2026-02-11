import Foundation

enum NegotiationEventType: String, Codable, CaseIterable {
    case surveyIssue
    case anotherViewer
    case chainRisk
    case rateNews
    case agentPressure
}

struct EventWeights: Codable, Equatable {
    var surveyIssue: Double
    var anotherViewer: Double
    var chainRisk: Double
    var rateNews: Double
    var agentPressure: Double

    static let `default` = EventWeights(
        surveyIssue: 0.23,
        anotherViewer: 0.24,
        chainRisk: 0.20,
        rateNews: 0.16,
        agentPressure: 0.17
    )

    func normalizedTuples() -> [(NegotiationEventType, Double)] {
        let tuples: [(NegotiationEventType, Double)] = [
            (.surveyIssue, surveyIssue),
            (.anotherViewer, anotherViewer),
            (.chainRisk, chainRisk),
            (.rateNews, rateNews),
            (.agentPressure, agentPressure)
        ]

        let total = tuples.reduce(0.0) { $0 + max(0, $1.1) }
        guard total > 0 else {
            let equal = 1.0 / Double(tuples.count)
            return tuples.map { ($0.0, equal) }
        }

        return tuples.map { ($0.0, max(0, $0.1) / total) }
    }
}

struct NegotiationEvent: Identifiable, Codable, Equatable {
    let id: UUID
    let type: NegotiationEventType
    let title: String
    let detail: String
    let icon: String
    let day: Int
    let expiresInDays: Int?

    init(
        id: UUID = UUID(),
        type: NegotiationEventType,
        title: String,
        detail: String,
        icon: String,
        day: Int,
        expiresInDays: Int? = nil
    ) {
        self.id = id
        self.type = type
        self.title = title
        self.detail = detail
        self.icon = icon
        self.day = day
        self.expiresInDays = expiresInDays
    }
}
