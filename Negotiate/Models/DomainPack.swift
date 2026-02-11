import Foundation

protocol ScenarioGeneratorProtocol {
    mutating func generateScenario(index: Int) -> Scenario
    mutating func generateScenarios(count: Int) -> [Scenario]
}

protocol EventDeckProtocol {
    mutating func maybeDrawEvent(turn: Int, day: Int, hiddenState: inout HiddenState, marketRegime: inout MarketRegime) -> NegotiationEvent?
}

struct DebriefTemplateSet {
    let whatWorkedTemplates: [String]
    let whatCostTemplates: [String]
}

protocol DomainPack {
    var id: String { get }
    var name: String { get }
    var description: String { get }
    var variableLabels: [String: String] { get }
    var termsSchema: [String] { get }

    func makeScenarioGenerator(seed: UInt64) -> any ScenarioGeneratorProtocol
    func makeEventDeck(for scenario: Scenario, seed: UInt64) -> any EventDeckProtocol
    func coachingTemplates(for outcome: NegotiationOutcome) -> DebriefTemplateSet
}

struct UKHousingPack: DomainPack {
    let id = "uk_housing"
    let name = "UK Housing"
    let description = "Buy-side residential property negotiations in the UK market."
    let variableLabels: [String: String] = [
        "reservationValue": "Seller Walk-Away Floor",
        "targetValue": "Seller Desired Price",
        "flexibility": "Price Flexibility",
        "alternativesStrength": "Alternative Buyer Strength",
        "egoSensitivity": "Ego Sensitivity",
        "patience": "Patience",
        "trust": "Trust",
        "riskTolerance": "Risk Tolerance",
        "fatigue": "Negotiation Fatigue",
        "deadlinePressure": "Deadline Pressure",
        "infoAsymmetry": "Information Asymmetry"
    ]

    let termsSchema = [
        "completionSpeed",
        "includedFixtures",
        "conditionalOnSurvey"
    ]

    func makeScenarioGenerator(seed: UInt64) -> any ScenarioGeneratorProtocol {
        UKHousingScenarioGenerator(pack: self, seed: seed)
    }

    func makeEventDeck(for scenario: Scenario, seed: UInt64) -> any EventDeckProtocol {
        EventDeck(weights: scenario.eventWeights, seed: seed)
    }

    func coachingTemplates(for outcome: NegotiationOutcome) -> DebriefTemplateSet {
        switch outcome.result {
        case .dealReached:
            return DebriefTemplateSet(
                whatWorkedTemplates: [
                    "You balanced price with terms, which improved perceived fairness.",
                    "You stayed in the conversation long enough for urgency to work in your favor.",
                    "Your asks extracted useful intel before major concessions."
                ],
                whatCostTemplates: [
                    "Some concessions came too early and reduced anchor strength.",
                    "Trust could have been built earlier with less aggressive openings."
                ]
            )
        case .sellerWithdrew:
            return DebriefTemplateSet(
                whatWorkedTemplates: [
                    "You protected your downside by not overpaying in a poor setup."
                ],
                whatCostTemplates: [
                    "Repeated low-perceived-respect moves likely triggered ego defenses.",
                    "The gap stayed wide while alternatives remained strong for the seller."
                ]
            )
        case .buyerWalkedAway:
            return DebriefTemplateSet(
                whatWorkedTemplates: [
                    "Walking away avoided a low-value deal if your threshold was strict."
                ],
                whatCostTemplates: [
                    "The timing may have been early if urgency had not peaked yet.",
                    "A final structured trade might have tested flexibility without overpaying."
                ]
            )
        case .timeout:
            return DebriefTemplateSet(
                whatWorkedTemplates: [
                    "You avoided rushed decisions under uncertainty."
                ],
                whatCostTemplates: [
                    "Pacing and holding pattern allowed momentum to stall.",
                    "Insufficient probing left information asymmetry too high."
                ]
            )
        }
    }
}
