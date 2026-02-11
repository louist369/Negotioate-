import Foundation

struct NegotiationAnalytics {
    let scenario: Scenario
    let actions: [NegotiationAction]
    let outcome: NegotiationOutcome
    let initialHiddenState: HiddenState
    let finalHiddenState: HiddenState
    let askHintCount: Int
    let rejectionCount: Int
    let callbackOccurred: Bool
}

struct ScoringEngine {
    func buildDebrief(
        analytics: NegotiationAnalytics,
        currentNCI: Double,
        pack: any DomainPack
    ) -> DebriefReport {
        let scores = score(analytics: analytics)
        let nciDelta = ((scores.aggregate - 50.0) / 18.0).clamped(to: -8...8)
        let nextNCI = (currentNCI + nciDelta).clamped(to: 0...100)

        let templates = pack.coachingTemplates(for: analytics.outcome)
        let why = causalSummary(analytics: analytics)

        return DebriefReport(
            revealedReservationValue: analytics.initialHiddenState.reservationValue,
            revealedTargetValue: analytics.initialHiddenState.targetValue,
            revealedEgoSensitivity: analytics.initialHiddenState.egoSensitivity,
            revealedUrgencyCurve: analytics.finalHiddenState.deadlinePressure,
            revealedAlternativesStrength: analytics.finalHiddenState.alternativesStrength,
            whyItHappened: why,
            whatWorked: templates.whatWorkedTemplates,
            whatCostValue: templates.whatCostTemplates,
            scores: scores,
            nciDelta: nciDelta,
            resultingNCI: nextNCI
        )
    }

    private func score(analytics: NegotiationAnalytics) -> DebriefScores {
        let offers = analytics.actions.compactMap { action in
            switch action.type {
            case .offer:
                return action.offeredPrice
            case .trade:
                guard let delta = action.priceDelta else { return nil }
                let base = offersBasePrice(actions: analytics.actions)
                return base.map { $0 + delta }
            default:
                return nil
            }
        }

        let firstOffer = offers.first ?? analytics.scenario.listingPrice
        let reservation = analytics.initialHiddenState.reservationValue
        let listing = analytics.scenario.listingPrice

        let anchoringDistance = Double(listing - firstOffer) / Double(max(1, listing - reservation))
        let anchoring = (55 + anchoringDistance * 35).clamped(to: 0...100)

        let concessionDiscipline = concessionScore(from: offers)

        let askCount = analytics.actions.filter { $0.type == .ask }.count
        let informationExtraction = (40 + Double(askCount) * 12 + Double(analytics.askHintCount) * 5).clamped(to: 0...100)

        let emotionalControl = (70 - Double(analytics.rejectionCount) * 8 + analytics.finalHiddenState.trust * 20).clamped(to: 0...100)

        let walkAwayTiming = walkAwayScore(analytics: analytics)

        return DebriefScores(
            anchoring: anchoring,
            concessionDiscipline: concessionDiscipline,
            informationExtraction: informationExtraction,
            emotionalControl: emotionalControl,
            walkAwayTiming: walkAwayTiming
        )
    }

    private func offersBasePrice(actions: [NegotiationAction]) -> Int? {
        actions.last(where: { $0.type == .offer })?.offeredPrice
    }

    private func concessionScore(from offers: [Int?]) -> Double {
        let compactOffers = offers.compactMap { $0 }
        guard compactOffers.count > 1 else { return 62 }

        var penalty = 0.0
        for i in 1..<compactOffers.count {
            let step = compactOffers[i] - compactOffers[i - 1]
            if step < 0 {
                penalty += 12
            } else {
                penalty += min(15, Double(step) / 1_250)
            }
        }

        return (85 - penalty).clamped(to: 0...100)
    }

    private func walkAwayScore(analytics: NegotiationAnalytics) -> Double {
        guard let walkAway = analytics.actions.first(where: { $0.type == .walkAway }) else {
            return analytics.outcome.result == .dealReached ? 72 : 55
        }

        let urgency = analytics.initialHiddenState.deadlinePressure
        let dayWeight = min(1.0, Double(walkAway.day) / 8.0)

        let base: Double = urgency > 0.6 ? 52 : 68
        let callbackBonus = analytics.callbackOccurred ? 8.0 : 0.0
        let timingAdjustment = (dayWeight * 18) - 10
        return (base + callbackBonus + timingAdjustment).clamped(to: 0...100)
    }

    private func causalSummary(analytics: NegotiationAnalytics) -> String {
        switch analytics.outcome.result {
        case .dealReached:
            return "The deal closed because your proposal crossed the seller's dynamic utility threshold as urgency and fatigue rose. Terms and trust reduced pure price resistance."
        case .sellerWithdrew:
            return "The seller withdrew after utility stayed below the counter band while trust and ego dynamics deteriorated. Strong alternatives lowered their need to keep negotiating."
        case .buyerWalkedAway:
            return analytics.callbackOccurred
                ? "You walked away at a point where urgency later outweighed ego, triggering a callback window."
                : "You exited before urgency overcame alternatives, so no callback materialized."
        case .timeout:
            return "The conversation ran out of momentum before acceptable utility was reached for either side."
        }
    }
}
