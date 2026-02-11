import Foundation

struct ScenarioGenerator {
    let pack: any DomainPack
    private var generator: any ScenarioGeneratorProtocol

    init(pack: any DomainPack, seed: UInt64) {
        self.pack = pack
        self.generator = pack.makeScenarioGenerator(seed: seed)
    }

    mutating func generate(count: Int) -> [Scenario] {
        generator.generateScenarios(count: count)
    }
}

struct UKHousingScenarioGenerator: ScenarioGeneratorProtocol {
    let pack: UKHousingPack
    private var rng: SeededRNG

    init(pack: UKHousingPack, seed: UInt64) {
        self.pack = pack
        self.rng = SeededRNG(seed: seed)
    }

    mutating func generateScenario(index: Int) -> Scenario {
        let region = Region.allCases[rng.nextInt(in: 0...(Region.allCases.count - 1))]
        let property = PropertyType.allCases[rng.nextInt(in: 0...(PropertyType.allCases.count - 1))]
        let regime = MarketRegime.allCases[rng.nextInt(in: 0...(MarketRegime.allCases.count - 1))]

        let archetype = weightedArchetype(for: regime)

        let listingRange = listingRange(for: region, property: property)
        let listingPrice = rng.nextInt(in: listingRange)

        let premium = askingPremium(for: regime)
        let reservation = Int(Double(listingPrice) * (1.0 - premium))
        let target = Int(Double(listingPrice) * (1.0 - (premium * 0.35))).clamped(to: reservation...Int.max)

        var hiddenState = HiddenState(
            reservationValue: reservation,
            targetValue: target,
            flexibility: baseFlexibility(for: archetype, regime: regime),
            alternativesStrength: alternativesStrength(for: regime),
            egoSensitivity: baseEgo(for: archetype),
            patience: basePatience(for: archetype),
            trust: rng.nextDouble() * 0.3 + 0.35,
            riskTolerance: rng.nextDouble() * 0.5 + 0.3,
            fatigue: rng.nextDouble() * 0.2,
            deadlinePressure: max(0.1, Double(rng.nextInt(in: 1...9)) / 20.0),
            infoAsymmetry: rng.nextDouble() * 0.45 + 0.35
        )
        hiddenState.clamp()

        let facts = KnownFacts(
            daysOnMarket: rng.nextInt(in: 3...140),
            chainStatusKnown: rng.nextBool(probability: 0.6),
            hasCompetingViewingsSignal: rng.nextBool(probability: regime == .hot ? 0.65 : 0.4)
        )

        let eventWeights = makeEventWeights(archetype: archetype, regime: regime)

        return Scenario(
            id: deterministicUUID(),
            domainPackID: pack.id,
            addressLabel: randomAddress(region: region),
            listingPrice: listingPrice,
            region: region,
            propertyType: property,
            knownFacts: facts,
            storyPrompt: storyPrompt(for: archetype, facts: facts, regime: regime),
            objective: "Get best terms without losing the deal.",
            sellerArchetype: archetype,
            marketRegime: regime,
            hiddenState: hiddenState,
            eventWeights: eventWeights
        )
    }

    mutating func generateScenarios(count: Int) -> [Scenario] {
        guard count > 0 else { return [] }
        return (0..<count).map { generateScenario(index: $0) }
    }

    private mutating func weightedArchetype(for regime: MarketRegime) -> SellerArchetype {
        let bag: [(SellerArchetype, Double)] = {
            switch regime {
            case .hot:
                return [
                    (.overpricer, 0.30),
                    (.hardliner, 0.26),
                    (.panicked, 0.10),
                    (.investor, 0.18),
                    (.emotional, 0.16)
                ]
            case .neutral:
                return [
                    (.overpricer, 0.23),
                    (.hardliner, 0.20),
                    (.panicked, 0.18),
                    (.investor, 0.21),
                    (.emotional, 0.18)
                ]
            case .cold:
                return [
                    (.overpricer, 0.15),
                    (.hardliner, 0.14),
                    (.panicked, 0.35),
                    (.investor, 0.18),
                    (.emotional, 0.18)
                ]
            }
        }()

        var cursor = rng.nextDouble()
        for (archetype, weight) in bag {
            cursor -= weight
            if cursor <= 0 {
                return archetype
            }
        }
        return .investor
    }

    private func listingRange(for region: Region, property: PropertyType) -> ClosedRange<Int> {
        switch (region, property) {
        case (.london, .flat): return 280_000...700_000
        case (.london, .terrace): return 450_000...1_000_000
        case (.london, .semiDetached): return 550_000...1_250_000
        case (.london, .detached): return 800_000...2_200_000

        case (.manchester, .flat): return 140_000...320_000
        case (.manchester, .terrace): return 190_000...380_000
        case (.manchester, .semiDetached): return 240_000...480_000
        case (.manchester, .detached): return 320_000...680_000

        case (.birmingham, .flat): return 130_000...280_000
        case (.birmingham, .terrace): return 170_000...340_000
        case (.birmingham, .semiDetached): return 220_000...430_000
        case (.birmingham, .detached): return 300_000...620_000

        case (.bristol, .flat): return 190_000...420_000
        case (.bristol, .terrace): return 260_000...520_000
        case (.bristol, .semiDetached): return 320_000...650_000
        case (.bristol, .detached): return 430_000...920_000

        case (.edinburgh, .flat): return 180_000...390_000
        case (.edinburgh, .terrace): return 250_000...500_000
        case (.edinburgh, .semiDetached): return 290_000...620_000
        case (.edinburgh, .detached): return 420_000...980_000
        }
    }

    private mutating func askingPremium(for regime: MarketRegime) -> Double {
        switch regime {
        case .hot:
            return rng.nextDouble() * 0.06 + 0.02
        case .neutral:
            return rng.nextDouble() * 0.07 + 0.05
        case .cold:
            return rng.nextDouble() * 0.10 + 0.08
        }
    }

    private mutating func baseFlexibility(for archetype: SellerArchetype, regime: MarketRegime) -> Double {
        let archetypeBase: Double
        switch archetype {
        case .overpricer: archetypeBase = 0.45
        case .hardliner: archetypeBase = 0.20
        case .panicked: archetypeBase = 0.70
        case .investor: archetypeBase = 0.52
        case .emotional: archetypeBase = 0.50
        }

        let regimeModifier: Double
        switch regime {
        case .hot: regimeModifier = -0.08
        case .neutral: regimeModifier = 0.0
        case .cold: regimeModifier = 0.10
        }

        return (archetypeBase + regimeModifier + (rng.nextDouble() * 0.1 - 0.05)).clamped(to: 0...1)
    }

    private mutating func alternativesStrength(for regime: MarketRegime) -> Double {
        let baseline: Double
        switch regime {
        case .hot: baseline = 0.72
        case .neutral: baseline = 0.50
        case .cold: baseline = 0.33
        }
        return (baseline + (rng.nextDouble() * 0.14 - 0.07)).clamped(to: 0...1)
    }

    private mutating func baseEgo(for archetype: SellerArchetype) -> Double {
        let range: ClosedRange<Double>
        switch archetype {
        case .overpricer: range = 0.58...0.82
        case .hardliner: range = 0.72...0.92
        case .panicked: range = 0.20...0.45
        case .investor: range = 0.35...0.56
        case .emotional: range = 0.56...0.80
        }
        return range.lowerBound + rng.nextDouble() * (range.upperBound - range.lowerBound)
    }

    private mutating func basePatience(for archetype: SellerArchetype) -> Double {
        let range: ClosedRange<Double>
        switch archetype {
        case .overpricer: range = 0.42...0.67
        case .hardliner: range = 0.55...0.80
        case .panicked: range = 0.18...0.38
        case .investor: range = 0.45...0.72
        case .emotional: range = 0.40...0.66
        }
        return range.lowerBound + rng.nextDouble() * (range.upperBound - range.lowerBound)
    }

    private mutating func makeEventWeights(archetype: SellerArchetype, regime: MarketRegime) -> EventWeights {
        var weights = EventWeights.default

        if regime == .hot {
            weights.anotherViewer += 0.08
            weights.rateNews -= 0.03
        } else if regime == .cold {
            weights.chainRisk += 0.07
            weights.surveyIssue += 0.04
        }

        switch archetype {
        case .panicked:
            weights.chainRisk += 0.08
            weights.agentPressure += 0.04
        case .hardliner:
            weights.agentPressure += 0.10
        case .investor:
            weights.rateNews += 0.08
        case .overpricer:
            weights.anotherViewer += 0.05
        case .emotional:
            weights.agentPressure += 0.06
        }

        return weights
    }

    private mutating func randomAddress(region: Region) -> String {
        let roads = [
            "Oakleigh", "Riverside", "Kingston", "Maple", "Cedar", "Rosebank", "Mill", "Willow", "Harbour", "Greenford"
        ]
        let suffixes = ["Street", "Road", "Close", "Avenue", "Lane", "Terrace"]
        let number = rng.nextInt(in: 3...187)
        let road = roads[rng.nextInt(in: 0...(roads.count - 1))]
        let suffix = suffixes[rng.nextInt(in: 0...(suffixes.count - 1))]
        return "\(number) \(road) \(suffix), \(region.displayName)"
    }

    private mutating func deterministicUUID() -> UUID {
        var high = rng.next()
        var low = rng.next()
        let bytes = withUnsafeBytes(of: &high) { Array($0) } + withUnsafeBytes(of: &low) { Array($0) }
        let tuple: uuid_t = (
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15]
        )
        return UUID(uuid: tuple)
    }

    private func storyPrompt(for archetype: SellerArchetype, facts: KnownFacts, regime: MarketRegime) -> String {
        let marketSentence: String
        switch regime {
        case .hot:
            marketSentence = "Market conditions are warm and sellers feel emboldened."
        case .neutral:
            marketSentence = "Market conditions are balanced."
        case .cold:
            marketSentence = "Demand is soft and timelines matter more."
        }

        let archetypeSentence: String
        switch archetype {
        case .overpricer:
            archetypeSentence = "Seller is known for overpricing with limited patience."
        case .hardliner:
            archetypeSentence = "Seller is a hardliner who reacts strongly to perceived disrespect."
        case .panicked:
            archetypeSentence = "Seller has pressure to move quickly and may prioritize speed."
        case .investor:
            archetypeSentence = "Seller is an investor focused on clean, efficient terms."
        case .emotional:
            archetypeSentence = "Seller is emotionally attached and tone-sensitive."
        }

        let factsSentence = facts.chainStatusKnown
            ? "Chain status is known; delays are visible."
            : "Chain status is unclear, so timeline risk is uncertain."

        return "You are the buyer. \(archetypeSentence) \(marketSentence) \(factsSentence)"
    }
}
