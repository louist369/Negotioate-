import Foundation

enum SellerDecisionType: String, Codable {
    case accept
    case counter
    case reject
    case withdraw
    case info
    case callback
}

struct SellerResponse: Codable, Equatable {
    let type: SellerDecisionType
    let mood: SellerMood
    let message: String
    let counterPrice: Int?
    let counterTerms: Terms?
}

enum NegotiationResultType: String, Codable {
    case dealReached
    case sellerWithdrew
    case buyerWalkedAway
    case timeout
}

struct NegotiationOutcome: Codable, Equatable {
    let result: NegotiationResultType
    let acceptedPrice: Int?
    let acceptedTerms: Terms?
    let dayResolved: Int
    let explanation: String
}

enum SessionPhase: Equatable {
    case active
    case walkedAwayPending(daysUntilCallback: Int)
    case resolved(NegotiationOutcome)
}
