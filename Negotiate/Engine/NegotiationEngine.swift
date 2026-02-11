import Foundation
import Combine

struct SoftMeters: Equatable {
    var momentum: Double
    var temperature: Double
    var trust: Double
    var urgency: Double

    static let zero = SoftMeters(momentum: 0.5, temperature: 0.5, trust: 0.5, urgency: 0.5)
}

enum MeterStateLabel {
    static func momentum(_ value: Double) -> String {
        switch value {
        case ..<0.25: return "Stalled"
        case ..<0.45: return "Slow"
        case ..<0.70: return "Building"
        default: return "Closing"
        }
    }

    static func temperature(_ value: Double) -> String {
        switch value {
        case ..<0.25: return "Cooling"
        case ..<0.50: return "Warm"
        case ..<0.75: return "Heated"
        default: return "Hot"
        }
    }

    static func trust(_ value: Double) -> String {
        switch value {
        case ..<0.30: return "Fragile"
        case ..<0.55: return "Guarded"
        case ..<0.75: return "Stable"
        default: return "Strong"
        }
    }

    static func urgency(_ value: Double) -> String {
        switch value {
        case ..<0.30: return "Low"
        case ..<0.60: return "Rising"
        case ..<0.80: return "Pressured"
        default: return "Critical"
        }
    }
}

enum FeedEntryType {
    case player
    case seller
    case event
    case dayLabel
}

struct FeedEntry: Identifiable, Equatable {
    let id: UUID
    let day: Int
    let type: FeedEntryType
    let text: String
    let mood: SellerMood?
    let event: NegotiationEvent?

    init(day: Int, type: FeedEntryType, text: String, mood: SellerMood? = nil, event: NegotiationEvent? = nil) {
        self.id = UUID()
        self.day = day
        self.type = type
        self.text = text
        self.mood = mood
        self.event = event
    }
}

final class NegotiationEngine: ObservableObject {
    @Published private(set) var scenario: Scenario
    @Published private(set) var phase: SessionPhase = .active
    @Published private(set) var day: Int = 1
    @Published private(set) var turn: Int = 0
    @Published private(set) var feed: [FeedEntry] = []
    @Published private(set) var beliefModel: BeliefModel
    @Published private(set) var meters: SoftMeters = .zero

    @Published private(set) var lastSellerResponse: SellerResponse?
    @Published private(set) var offerExpiryDay: Int?

    private(set) var actionLog: [NegotiationAction] = []

    private let pack: any DomainPack
    private let scoringEngine: ScoringEngine

    private var hiddenState: HiddenState
    private let initialHiddenState: HiddenState
    private var marketRegime: MarketRegime
    private var eventDeck: any EventDeckProtocol
    private var rng: SeededRNG

    private var rejectionCount: Int = 0
    private var disrespectStreak: Int = 0
    private var askHintCount: Int = 0
    private var callbackOccurred = false
    private var latestOfferPrice: Int?
    private var latestOfferTerms: Terms = .default

    init(scenario: Scenario, pack: any DomainPack, seed: UInt64) {
        self.scenario = scenario
        self.pack = pack
        self.hiddenState = scenario.hiddenState
        self.initialHiddenState = scenario.hiddenState
        self.marketRegime = scenario.marketRegime
        self.beliefModel = BeliefModel.initial(for: scenario)
        self.rng = SeededRNG(seed: seed)
        self.eventDeck = pack.makeEventDeck(for: scenario, seed: seed &+ 0xA341_316C)
        self.scoringEngine = ScoringEngine()

        self.feed = [
            FeedEntry(day: 1, type: .dayLabel, text: "Day 1"),
            FeedEntry(
                day: 1,
                type: .seller,
                text: "Listing is at £\(scenario.listingPrice). Seller opens firm.",
                mood: .firm
            )
        ]
        updateMeters()
    }

    func submit(_ action: NegotiationAction) {
        switch phase {
        case .resolved:
            return
        case .walkedAwayPending:
            guard action.type == .advanceDay else { return }
            processPendingCallbackAdvance(action)
        case .active:
            processActiveAction(action)
        }
    }

    func makeRunHistoryItem(currentNCI: Double) -> RunHistoryItem? {
        guard case .resolved(let outcome) = phase else { return nil }

        let analytics = NegotiationAnalytics(
            scenario: scenario,
            actions: actionLog,
            outcome: outcome,
            initialHiddenState: initialHiddenState,
            finalHiddenState: hiddenState,
            askHintCount: askHintCount,
            rejectionCount: rejectionCount,
            callbackOccurred: callbackOccurred
        )

        let debrief = scoringEngine.buildDebrief(analytics: analytics, currentNCI: currentNCI, pack: pack)
        return RunHistoryItem(
            id: UUID(),
            scenarioID: scenario.id,
            scenarioTitle: scenario.addressLabel,
            listingPrice: scenario.listingPrice,
            startedAt: Date().addingTimeInterval(-Double(max(1, turn) * 20)),
            endedAt: Date(),
            actions: actionLog,
            outcome: outcome,
            debrief: debrief
        )
    }

    func callbackProbabilityEstimateForTesting() -> Double {
        callbackProbability(currentGap: currentGapToReservation())
    }

    private func processActiveAction(_ action: NegotiationAction) {
        addDayIfNeeded()
        actionLog.append(action)
        feed.append(FeedEntry(day: day, type: .player, text: action.playerText))

        advanceGlobalPressure()

        let response: SellerResponse

        switch action.type {
        case .offer:
            let price = max(0, action.offeredPrice ?? 0)
            let terms = action.terms ?? .default
            latestOfferPrice = price
            latestOfferTerms = terms
            response = evaluateOffer(price: price, terms: terms)
        case .trade:
            let base = latestOfferPrice ?? scenario.listingPrice
            let adjustedPrice = max(0, base + (action.priceDelta ?? 0))
            let terms = action.terms ?? latestOfferTerms
            latestOfferPrice = adjustedPrice
            latestOfferTerms = terms
            response = evaluateOffer(price: adjustedPrice, terms: terms)
        case .ask:
            response = answerQuestion(action.question ?? .timeline)
        case .hold:
            response = holdResponse()
        case .walkAway:
            response = resolveWalkAway()
        case .advanceDay:
            response = SellerResponse(type: .info, mood: .cold, message: "Waiting for movement.", counterPrice: nil, counterTerms: nil)
        }

        lastSellerResponse = response
        beliefModel.updateFromResponse(response, listingPrice: scenario.listingPrice)

        feed.append(FeedEntry(day: day, type: .seller, text: response.message, mood: response.mood))

        evaluateResponseEffects(response)

        if case .active = phase {
            maybeFireEvent()
        }

        updateMeters()
        checkOfferExpiry()
    }

    private func processPendingCallbackAdvance(_ action: NegotiationAction) {
        actionLog.append(action)
        day += 1
        feed.append(FeedEntry(day: day, type: .dayLabel, text: "Day \(day)"))
        feed.append(FeedEntry(day: day, type: .player, text: action.playerText))

        switch phase {
        case .walkedAwayPending(let pendingDays):
            let remaining = max(0, pendingDays - 1)
            if remaining == 0 {
                triggerCallback()
            } else {
                phase = .walkedAwayPending(daysUntilCallback: remaining)
                feed.append(
                    FeedEntry(
                        day: day,
                        type: .seller,
                        text: "No callback yet. Silence continues.",
                        mood: .cold
                    )
                )
            }
        default:
            break
        }

        updateMeters()
    }

    private func advanceGlobalPressure() {
        turn += 1
        hiddenState.deadlinePressure += 0.035 + scenario.sellerArchetype.profile.urgencyAcceleration * 0.05
        hiddenState.fatigue += 0.04
        hiddenState.patience -= 0.03
        hiddenState.trust -= 0.01
        hiddenState.clamp()
    }

    private func evaluateOffer(price: Int, terms: Terms) -> SellerResponse {
        let profile = scenario.sellerArchetype.profile

        let priceUtility = normalizedPriceUtility(offerPrice: price)
        let termsUtility = terms.sellerUtility

        let gapToTarget = Double(max(0, hiddenState.targetValue - price)) / Double(max(1, hiddenState.targetValue))
        let lowballFactor = Double(max(0, hiddenState.reservationValue - price)) / Double(max(1, hiddenState.reservationValue))

        let trustComponent = hiddenState.trust * 2 - 1
        let egoReaction = -hiddenState.egoSensitivity * lowballFactor
        let urgencyComponent = hiddenState.deadlinePressure * (1.0 - gapToTarget)
        let fatigueComponent = hiddenState.fatigue * 0.5

        let noise = rng.nextDouble() * 0.14 - 0.07

        let utility =
            profile.wPrice * priceUtility +
            profile.wTerms * termsUtility +
            profile.wTrust * trustComponent +
            profile.wEgo * egoReaction +
            profile.wUrgency * urgencyComponent +
            profile.wFatigue * fatigueComponent +
            noise

        let acceptThreshold = dynamicAcceptThreshold(profile: profile)
        let counterBand = dynamicCounterBand(profile: profile)
        let rejectThreshold = acceptThreshold - counterBand

        if lowballFactor > 0.08 {
            disrespectStreak += 1
            hiddenState.trust -= profile.disrespectPenalty * min(1.0, lowballFactor * 2)
        } else {
            disrespectStreak = max(0, disrespectStreak - 1)
            hiddenState.trust += 0.02
        }

        hiddenState.clamp()

        if shouldWithdraw(lowballFactor: lowballFactor, utility: utility, profile: profile) {
            return SellerResponse(
                type: .withdraw,
                mood: .offended,
                message: "Seller withdraws the listing from this negotiation.",
                counterPrice: nil,
                counterTerms: nil
            )
        }

        if utility >= acceptThreshold {
            let message = "Accepted at £\(price) with your terms."
            return SellerResponse(type: .accept, mood: .warming, message: message, counterPrice: price, counterTerms: terms)
        }

        if utility >= rejectThreshold {
            let counter = computeCounterPrice(from: price)
            let counterTerms = counterTerms(from: terms)
            let mood: SellerMood = utility > rejectThreshold + (counterBand * 0.5) ? .firm : .irritated
            return SellerResponse(
                type: .counter,
                mood: mood,
                message: "Counter at £\(counter). Seller wants \(counterTerms.summary.lowercased()).",
                counterPrice: counter,
                counterTerms: counterTerms
            )
        }

        return SellerResponse(
            type: .reject,
            mood: lowballFactor > 0.10 ? .offended : .cold,
            message: "Rejected. Seller says this does not reflect current expectations.",
            counterPrice: nil,
            counterTerms: nil
        )
    }

    private func answerQuestion(_ question: AskQuestion) -> SellerResponse {
        let profile = scenario.sellerArchetype.profile
        hiddenState.trust += profile.askTrustDelta

        let hint: String
        switch question {
        case .timeline:
            if hiddenState.deadlinePressure > 0.62 {
                hint = "Seller needs to move quickly."
                beliefModel.ingestHint(hint, reservationShift: -3_000, urgencyShift: 0.16, alternativesShift: -0.03)
            } else {
                hint = "Seller can wait if needed."
                beliefModel.ingestHint(hint, reservationShift: 2_000, urgencyShift: -0.08, alternativesShift: 0.02)
            }

        case .alternatives:
            if hiddenState.alternativesStrength > 0.58 {
                hint = "Agent hints there were other viewings."
                beliefModel.ingestHint(hint, reservationShift: 1_500, urgencyShift: -0.04, alternativesShift: 0.15)
            } else {
                hint = "Competition seems thinner than expected."
                beliefModel.ingestHint(hint, reservationShift: -2_000, urgencyShift: 0.05, alternativesShift: -0.12)
            }

        case .flexibility:
            if hiddenState.egoSensitivity > 0.62 {
                hint = "Seller seems offended by low offers."
                beliefModel.ingestHint(hint, reservationShift: 3_000, urgencyShift: 0.0, alternativesShift: 0.04)
            } else {
                hint = "Seller may trade on terms if price is close."
                beliefModel.ingestHint(hint, reservationShift: -1_500, urgencyShift: 0.04, alternativesShift: -0.02)
            }
        }

        askHintCount += 1
        hiddenState.clamp()

        return SellerResponse(
            type: .info,
            mood: .firm,
            message: hint,
            counterPrice: nil,
            counterTerms: nil
        )
    }

    private func holdResponse() -> SellerResponse {
        hiddenState.fatigue += 0.03
        hiddenState.trust -= 0.03
        hiddenState.deadlinePressure += 0.03
        hiddenState.clamp()

        return SellerResponse(
            type: .info,
            mood: .anxious,
            message: "Seller asks whether you can improve your position today.",
            counterPrice: nil,
            counterTerms: nil
        )
    }

    private func resolveWalkAway() -> SellerResponse {
        let gap = currentGapToReservation()
        let probability = callbackProbability(currentGap: gap)

        let willCallback = rng.nextBool(probability: probability)
        if willCallback {
            let delay = rng.nextInt(in: 1...3)
            phase = .walkedAwayPending(daysUntilCallback: delay)
            return SellerResponse(
                type: .info,
                mood: .cold,
                message: "You leave the table. The seller goes quiet.",
                counterPrice: nil,
                counterTerms: nil
            )
        }

        let outcome = NegotiationOutcome(
            result: .buyerWalkedAway,
            acceptedPrice: nil,
            acceptedTerms: nil,
            dayResolved: day,
            explanation: "You exited and no callback came."
        )
        phase = .resolved(outcome)
        return SellerResponse(
            type: .withdraw,
            mood: .cold,
            message: "No callback arrives. Negotiation ends.",
            counterPrice: nil,
            counterTerms: nil
        )
    }

    private func triggerCallback() {
        callbackOccurred = true
        hiddenState.deadlinePressure += 0.14
        hiddenState.alternativesStrength -= 0.12
        hiddenState.trust += 0.05
        hiddenState.clamp()

        offerExpiryDay = day + 1
        phase = .active

        let callbackType = rng.nextDouble()
        let message: String
        if callbackType < 0.33 {
            let improved = max(hiddenState.reservationValue, (latestOfferPrice ?? scenario.listingPrice) + 2_500)
            message = "Callback: seller re-opens at £\(improved) and asks for a quick close."
            latestOfferPrice = improved
        } else if callbackType < 0.66 {
            message = "Callback: seller asks for your final offer within 1 day."
        } else {
            message = "Callback: seller holds terms but is willing to talk tonight."
        }

        let response = SellerResponse(type: .callback, mood: .anxious, message: message, counterPrice: latestOfferPrice, counterTerms: latestOfferTerms)
        lastSellerResponse = response
        feed.append(FeedEntry(day: day, type: .seller, text: message, mood: .anxious))
    }

    private func evaluateResponseEffects(_ response: SellerResponse) {
        switch response.type {
        case .accept:
            let outcome = NegotiationOutcome(
                result: .dealReached,
                acceptedPrice: response.counterPrice ?? latestOfferPrice,
                acceptedTerms: response.counterTerms ?? latestOfferTerms,
                dayResolved: day,
                explanation: "Seller utility crossed the accept threshold."
            )
            phase = .resolved(outcome)
            hiddenState.trust += 0.10

        case .counter:
            hiddenState.trust += 0.01
            if let counterPrice = response.counterPrice {
                latestOfferPrice = counterPrice
            }

        case .reject:
            rejectionCount += 1
            hiddenState.trust -= 0.05

        case .withdraw:
            let result: NegotiationResultType = actionLog.last?.type == .walkAway ? .buyerWalkedAway : .sellerWithdrew
            let explanation = result == .sellerWithdrew
                ? "Seller exited due to low trust and unfavorable utility."
                : "You walked away and the thread closed."
            phase = .resolved(
                NegotiationOutcome(
                    result: result,
                    acceptedPrice: nil,
                    acceptedTerms: nil,
                    dayResolved: day,
                    explanation: explanation
                )
            )

        case .info:
            break

        case .callback:
            break
        }

        hiddenState.clamp()
    }

    private func maybeFireEvent() {
        guard var deck = optionalDeck else { return }
        guard let event = deck.maybeDrawEvent(turn: turn, day: day, hiddenState: &hiddenState, marketRegime: &marketRegime) else {
            eventDeck = deck
            return
        }

        eventDeck = deck
        if let expires = event.expiresInDays {
            offerExpiryDay = day + expires
        }

        feed.append(FeedEntry(day: day, type: .event, text: event.detail, event: event))
    }

    private var optionalDeck: (any EventDeckProtocol)? {
        eventDeck
    }

    private func checkOfferExpiry() {
        guard let expiry = offerExpiryDay else { return }
        guard day > expiry else { return }
        guard case .active = phase else { return }

        phase = .resolved(
            NegotiationOutcome(
                result: .sellerWithdrew,
                acceptedPrice: nil,
                acceptedTerms: nil,
                dayResolved: day,
                explanation: "A time-limited offer lapsed."
            )
        )

        feed.append(
            FeedEntry(
                day: day,
                type: .seller,
                text: "The deadline expired. Seller withdraws.",
                mood: .offended
            )
        )
    }

    private func updateMeters() {
        let trust = hiddenState.trust.clamped(to: 0...1)
        let urgency = hiddenState.deadlinePressure.clamped(to: 0...1)
        let temperature = (
            hiddenState.egoSensitivity * 0.45 +
            hiddenState.fatigue * 0.30 +
            (1 - hiddenState.trust) * 0.35
        ).clamped(to: 0...1)

        let momentum = (
            trust * 0.28 +
            urgency * 0.26 +
            hiddenState.flexibility * 0.20 +
            (1 - hiddenState.alternativesStrength) * 0.18 -
            temperature * 0.12
        ).clamped(to: 0...1)

        meters = SoftMeters(
            momentum: momentum,
            temperature: temperature,
            trust: trust,
            urgency: urgency
        )
    }

    private func dynamicAcceptThreshold(profile: ArchetypeProfile) -> Double {
        let threshold =
            profile.baseAcceptThreshold +
            hiddenState.egoSensitivity * 0.12 +
            hiddenState.alternativesStrength * 0.08 -
            hiddenState.deadlinePressure * 0.17 -
            hiddenState.fatigue * 0.09 -
            hiddenState.trust * 0.06
        return threshold.clamped(to: 0.32...0.86)
    }

    private func dynamicCounterBand(profile: ArchetypeProfile) -> Double {
        let band =
            profile.baseCounterBand +
            hiddenState.flexibility * 0.12 +
            hiddenState.deadlinePressure * 0.06 -
            hiddenState.egoSensitivity * 0.05
        return band.clamped(to: 0.08...0.33)
    }

    private func shouldWithdraw(lowballFactor: Double, utility: Double, profile: ArchetypeProfile) -> Bool {
        let withdrawalPressure =
            (Double(disrespectStreak) * 0.06) +
            ((1 - hiddenState.trust) * 0.18) +
            (hiddenState.egoSensitivity * 0.14) +
            (hiddenState.alternativesStrength * 0.11) -
            (hiddenState.deadlinePressure * 0.12)

        if utility < profile.baseWithdrawThreshold && withdrawalPressure > 0.23 {
            return true
        }

        return lowballFactor > 0.14 && hiddenState.trust < 0.22 && hiddenState.egoSensitivity > 0.65
    }

    private func computeCounterPrice(from offerPrice: Int) -> Int {
        let stepFactor = (0.48 - hiddenState.flexibility * 0.24 - hiddenState.deadlinePressure * 0.14).clamped(to: 0.14...0.58)
        let gap = max(0, hiddenState.targetValue - offerPrice)
        let increment = Int(Double(gap) * stepFactor)
        return max(hiddenState.reservationValue, offerPrice + max(1_000, increment))
    }

    private func counterTerms(from terms: Terms) -> Terms {
        var updated = terms
        if hiddenState.deadlinePressure > 0.55 {
            updated.completionSpeed = .fast
        }
        if scenario.sellerArchetype == .hardliner && rng.nextBool(probability: 0.55) {
            updated.conditionalOnSurvey = false
        }
        return updated
    }

    private func normalizedPriceUtility(offerPrice: Int) -> Double {
        let floor = hiddenState.reservationValue
        let target = hiddenState.targetValue

        if offerPrice <= floor {
            let below = Double(floor - offerPrice) / Double(max(1, floor))
            return (-1.0 - below).clamped(to: -1.6...1.0)
        }

        let span = max(1, target - floor)
        let ratio = Double(offerPrice - floor) / Double(span)
        return (ratio * 1.2 - 0.1).clamped(to: -1.6...1.2)
    }

    private func callbackProbability(currentGap: Double) -> Double {
        let profile = scenario.sellerArchetype.profile
        let closeness = (1.0 - currentGap).clamped(to: 0...1)

        let probability =
            profile.callbackBaseProbability +
            hiddenState.deadlinePressure * 0.34 +
            closeness * 0.20 -
            hiddenState.alternativesStrength * 0.26 -
            hiddenState.egoSensitivity * 0.18

        return probability.clamped(to: 0.02...0.92)
    }

    private func currentGapToReservation() -> Double {
        let reference = latestOfferPrice ?? scenario.listingPrice
        let gap = abs(reference - hiddenState.reservationValue)
        return Double(gap) / Double(max(1, scenario.listingPrice))
    }

    private func addDayIfNeeded() {
        day += 1
        feed.append(FeedEntry(day: day, type: .dayLabel, text: "Day \(day)"))
    }
}
