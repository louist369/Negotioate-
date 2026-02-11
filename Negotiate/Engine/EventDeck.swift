import Foundation

struct EventDeck: EventDeckProtocol {
    private var weights: EventWeights
    private var rng: SeededRNG

    init(weights: EventWeights, seed: UInt64) {
        self.weights = weights
        self.rng = SeededRNG(seed: seed)
    }

    mutating func maybeDrawEvent(turn: Int, day: Int, hiddenState: inout HiddenState, marketRegime: inout MarketRegime) -> NegotiationEvent? {
        let baseChance = 0.30
        let turnModifier = min(0.18, Double(turn) * 0.02)
        let drawChance = baseChance + turnModifier

        guard rng.nextBool(probability: drawChance) else {
            return nil
        }

        let eventType = weightedEventType()
        let event = apply(eventType, day: day, hiddenState: &hiddenState, marketRegime: &marketRegime)
        hiddenState.clamp()
        return event
    }

    private mutating func weightedEventType() -> NegotiationEventType {
        let tuples = weights.normalizedTuples()
        var cursor = rng.nextDouble()
        for (type, weight) in tuples {
            cursor -= weight
            if cursor <= 0 {
                return type
            }
        }
        return tuples.last?.0 ?? .agentPressure
    }

    private mutating func apply(
        _ type: NegotiationEventType,
        day: Int,
        hiddenState: inout HiddenState,
        marketRegime: inout MarketRegime
    ) -> NegotiationEvent {
        switch type {
        case .surveyIssue:
            hiddenState.targetValue -= rng.nextInt(in: 2_000...8_000)
            hiddenState.reservationValue -= rng.nextInt(in: 1_000...4_000)
            hiddenState.trust += 0.03
            return NegotiationEvent(
                type: .surveyIssue,
                title: "Survey Issue Found",
                detail: "A structural issue surfaced. Seller confidence dips and your leverage improves.",
                icon: "exclamationmark.triangle.fill",
                day: day
            )

        case .anotherViewer:
            hiddenState.alternativesStrength += 0.12
            hiddenState.egoSensitivity += 0.05
            let expires = rng.nextBool(probability: 0.35) ? 1 : nil
            return NegotiationEvent(
                type: .anotherViewer,
                title: "Another Viewer Interested",
                detail: "The agent reports renewed interest from another buyer.",
                icon: "person.fill",
                day: day,
                expiresInDays: expires
            )

        case .chainRisk:
            hiddenState.deadlinePressure += 0.16
            hiddenState.patience -= 0.08
            return NegotiationEvent(
                type: .chainRisk,
                title: "Chain Risk Emerges",
                detail: "Upstream chain uncertainty increases pressure to move quickly.",
                icon: "clock.fill",
                day: day
            )

        case .rateNews:
            let drift = rng.nextDouble()
            if drift < 0.4 {
                marketRegime = .cold
                hiddenState.alternativesStrength -= 0.10
                hiddenState.deadlinePressure += 0.08
            } else if drift < 0.75 {
                marketRegime = .neutral
            } else {
                marketRegime = .hot
                hiddenState.alternativesStrength += 0.08
            }

            return NegotiationEvent(
                type: .rateNews,
                title: "Rate News Shift",
                detail: "Mortgage-rate news shifts market sentiment to \(marketRegime.displayName.lowercased()).",
                icon: "chart.line.uptrend.xyaxis",
                day: day
            )

        case .agentPressure:
            let soft = rng.nextBool(probability: 0.55)
            if soft {
                hiddenState.trust += 0.05
                hiddenState.deadlinePressure += 0.06
            } else {
                hiddenState.trust -= 0.08
                hiddenState.egoSensitivity += 0.06
            }

            return NegotiationEvent(
                type: .agentPressure,
                title: "Agent Pressure",
                detail: soft
                    ? "Agent suggests both sides should lock terms now."
                    : "Agent frames your last move as too aggressive.",
                icon: "person.badge.shield.checkmark",
                day: day
            )
        }
    }
}
