import XCTest
@testable import Negotiate

final class NegotiateTests: XCTestCase {
    func testScenarioGenerationReproducibility() {
        var first = ScenarioGenerator(pack: UKHousingPack(), seed: 123456)
        var second = ScenarioGenerator(pack: UKHousingPack(), seed: 123456)

        let lhs = first.generate(count: 25)
        let rhs = second.generate(count: 25)

        XCTAssertEqual(lhs, rhs)
    }

    func testEngineResponseConsistencyForKnownAction() {
        let scenario = sampleScenario(archetype: .investor)

        let engine = NegotiationEngine(scenario: scenario, pack: UKHousingPack(), seed: 9)
        engine.submit(.offer(price: 0, terms: .default, day: engine.day))

        XCTAssertEqual(engine.lastSellerResponse?.type, .reject)
    }

    func testWalkAwayCallbackProbabilityIsHigherForPanickedThanHardliner() {
        let base = sampleScenario(archetype: .investor)

        let panickedScenario = Scenario(
            id: base.id,
            domainPackID: base.domainPackID,
            addressLabel: base.addressLabel,
            listingPrice: base.listingPrice,
            region: base.region,
            propertyType: base.propertyType,
            knownFacts: base.knownFacts,
            storyPrompt: base.storyPrompt,
            objective: base.objective,
            sellerArchetype: .panicked,
            marketRegime: base.marketRegime,
            hiddenState: base.hiddenState,
            eventWeights: base.eventWeights
        )

        let hardlinerScenario = Scenario(
            id: base.id,
            domainPackID: base.domainPackID,
            addressLabel: base.addressLabel,
            listingPrice: base.listingPrice,
            region: base.region,
            propertyType: base.propertyType,
            knownFacts: base.knownFacts,
            storyPrompt: base.storyPrompt,
            objective: base.objective,
            sellerArchetype: .hardliner,
            marketRegime: base.marketRegime,
            hiddenState: base.hiddenState,
            eventWeights: base.eventWeights
        )

        let panicked = NegotiationEngine(scenario: panickedScenario, pack: UKHousingPack(), seed: 1)
        let hardliner = NegotiationEngine(scenario: hardlinerScenario, pack: UKHousingPack(), seed: 1)

        XCTAssertGreaterThan(panicked.callbackProbabilityEstimateForTesting(), hardliner.callbackProbabilityEstimateForTesting())
    }

    func testScoringEngineUpdatesNCIUpForGoodRun() {
        let scenario = sampleScenario(archetype: .panicked)
        let outcome = NegotiationOutcome(
            result: .dealReached,
            acceptedPrice: 278_000,
            acceptedTerms: Terms(completionSpeed: .fast, includedFixtures: .some, conditionalOnSurvey: false),
            dayResolved: 5,
            explanation: "Accepted"
        )

        let actions = [
            NegotiationAction.offer(price: 260_000, terms: .default, day: 1),
            NegotiationAction.ask(.timeline, day: 2),
            NegotiationAction.trade(delta: 10_000, terms: Terms(completionSpeed: .fast, includedFixtures: .some, conditionalOnSurvey: false), day: 3)
        ]

        let analytics = NegotiationAnalytics(
            scenario: scenario,
            actions: actions,
            outcome: outcome,
            initialHiddenState: scenario.hiddenState,
            finalHiddenState: HiddenState(
                reservationValue: 250_000,
                targetValue: 285_000,
                flexibility: 0.72,
                alternativesStrength: 0.32,
                egoSensitivity: 0.35,
                patience: 0.25,
                trust: 0.70,
                riskTolerance: 0.58,
                fatigue: 0.45,
                deadlinePressure: 0.82,
                infoAsymmetry: 0.28
            ),
            askHintCount: 2,
            rejectionCount: 0,
            callbackOccurred: false
        )

        let engine = ScoringEngine()
        let report = engine.buildDebrief(analytics: analytics, currentNCI: 50, pack: UKHousingPack())

        XCTAssertGreaterThan(report.resultingNCI, 50)
        XCTAssertGreaterThan(report.scores.aggregate, 50)
    }

    func testPersistenceRoundTripScenariosAndHistory() throws {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("NegotiateTests-\(UUID().uuidString)", isDirectory: true)
        let storage = Storage(baseDirectoryOverride: tempDir)

        var generator = ScenarioGenerator(pack: UKHousingPack(), seed: 42)
        let scenarios = generator.generate(count: 5)

        try storage.saveScenarios(scenarios)
        let loadedScenarios = try storage.loadScenarios()

        XCTAssertEqual(scenarios, loadedScenarios)

        let historyItem = RunHistoryItem(
            id: UUID(),
            scenarioID: scenarios[0].id,
            scenarioTitle: scenarios[0].addressLabel,
            listingPrice: scenarios[0].listingPrice,
            startedAt: Date(timeIntervalSince1970: 1_000),
            endedAt: Date(timeIntervalSince1970: 1_200),
            actions: [NegotiationAction.offer(price: 200_000, terms: .default, day: 1)],
            outcome: NegotiationOutcome(result: .sellerWithdrew, acceptedPrice: nil, acceptedTerms: nil, dayResolved: 2, explanation: "No deal"),
            debrief: DebriefReport(
                revealedReservationValue: 180_000,
                revealedTargetValue: 230_000,
                revealedEgoSensitivity: 0.6,
                revealedUrgencyCurve: 0.4,
                revealedAlternativesStrength: 0.7,
                whyItHappened: "Test",
                whatWorked: ["A"],
                whatCostValue: ["B"],
                scores: DebriefScores(anchoring: 40, concessionDiscipline: 50, informationExtraction: 60, emotionalControl: 70, walkAwayTiming: 80),
                nciDelta: -1,
                resultingNCI: 49
            )
        )

        try storage.saveHistory([historyItem])
        let loadedHistory = try storage.loadHistory()

        XCTAssertEqual(loadedHistory, [historyItem])
    }

    func testEdgeCasesOfferReservationZeroAndWalkAwayRoundOne() {
        let scenario = sampleScenario(archetype: .panicked)

        let reservationEngine = NegotiationEngine(scenario: scenario, pack: UKHousingPack(), seed: 5)
        reservationEngine.submit(.offer(price: scenario.hiddenState.reservationValue, terms: .default, day: reservationEngine.day))
        XCTAssertNotNil(reservationEngine.lastSellerResponse)

        let zeroEngine = NegotiationEngine(scenario: scenario, pack: UKHousingPack(), seed: 5)
        zeroEngine.submit(.offer(price: 0, terms: .default, day: zeroEngine.day))
        XCTAssertTrue([SellerDecisionType.reject, SellerDecisionType.withdraw].contains(zeroEngine.lastSellerResponse?.type ?? .info))

        let walkAwayEngine = NegotiationEngine(scenario: scenario, pack: UKHousingPack(), seed: 5)
        walkAwayEngine.submit(.walkAway(day: walkAwayEngine.day))

        switch walkAwayEngine.phase {
        case .walkedAwayPending:
            XCTAssertTrue(true)
        case .resolved(let outcome):
            XCTAssertEqual(outcome.result, .buyerWalkedAway)
        case .active:
            XCTFail("Walk away on round one should not remain active")
        }
    }

    private func sampleScenario(archetype: SellerArchetype) -> Scenario {
        Scenario(
            id: UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!,
            domainPackID: "uk_housing",
            addressLabel: "101 Test Road, Manchester",
            listingPrice: 300_000,
            region: .manchester,
            propertyType: .terrace,
            knownFacts: KnownFacts(daysOnMarket: 54, chainStatusKnown: true, hasCompetingViewingsSignal: true),
            storyPrompt: "Test scenario",
            objective: "Get best terms without losing the deal.",
            sellerArchetype: archetype,
            marketRegime: .neutral,
            hiddenState: HiddenState(
                reservationValue: 250_000,
                targetValue: 295_000,
                flexibility: 0.48,
                alternativesStrength: 0.20,
                egoSensitivity: 0.15,
                patience: 0.52,
                trust: 0.80,
                riskTolerance: 0.55,
                fatigue: 0.15,
                deadlinePressure: 0.10,
                infoAsymmetry: 0.40
            ),
            eventWeights: .default
        )
    }
}
