import Foundation

enum AskQuestion: String, Codable, CaseIterable, Identifiable {
    case timeline = "What timeline does the seller need?"
    case alternatives = "Are there other serious viewers?"
    case flexibility = "How fixed is the asking stance?"

    var id: String { rawValue }
}

enum NegotiationActionType: String, Codable {
    case offer
    case trade
    case ask
    case hold
    case walkAway
    case advanceDay
}

struct NegotiationAction: Codable, Equatable, Identifiable {
    let id: UUID
    let type: NegotiationActionType
    let offeredPrice: Int?
    let priceDelta: Int?
    let terms: Terms?
    let question: AskQuestion?
    let day: Int
    let timestamp: Date

    init(
        id: UUID = UUID(),
        type: NegotiationActionType,
        offeredPrice: Int? = nil,
        priceDelta: Int? = nil,
        terms: Terms? = nil,
        question: AskQuestion? = nil,
        day: Int,
        timestamp: Date = Date()
    ) {
        self.id = id
        self.type = type
        self.offeredPrice = offeredPrice
        self.priceDelta = priceDelta
        self.terms = terms
        self.question = question
        self.day = day
        self.timestamp = timestamp
    }

    static func offer(price: Int, terms: Terms, day: Int) -> NegotiationAction {
        NegotiationAction(type: .offer, offeredPrice: price, terms: terms, day: day)
    }

    static func trade(delta: Int, terms: Terms, day: Int) -> NegotiationAction {
        NegotiationAction(type: .trade, priceDelta: delta, terms: terms, day: day)
    }

    static func ask(_ question: AskQuestion, day: Int) -> NegotiationAction {
        NegotiationAction(type: .ask, question: question, day: day)
    }

    static func hold(day: Int) -> NegotiationAction {
        NegotiationAction(type: .hold, day: day)
    }

    static func walkAway(day: Int) -> NegotiationAction {
        NegotiationAction(type: .walkAway, day: day)
    }

    static func advanceDay(day: Int) -> NegotiationAction {
        NegotiationAction(type: .advanceDay, day: day)
    }

    var playerText: String {
        switch type {
        case .offer:
            return "Offered £\(offeredPrice ?? 0) with terms: \(terms?.summary ?? Terms.default.summary)."
        case .trade:
            let delta = priceDelta ?? 0
            let sign = delta >= 0 ? "+" : ""
            return "Proposed trade \(sign)£\(delta) with \(terms?.summary ?? Terms.default.summary)."
        case .ask:
            return question?.rawValue ?? "Asked for more clarity."
        case .hold:
            return "Held position and waited."
        case .walkAway:
            return "Walked away from the negotiation."
        case .advanceDay:
            return "Waited one more day for a callback."
        }
    }
}
