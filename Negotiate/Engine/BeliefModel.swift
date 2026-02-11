import Foundation

struct IntBand: Codable, Equatable {
    var lower: Int
    var upper: Int

    mutating func clamp(min: Int, max: Int) {
        lower = lower.clamped(to: min...max)
        upper = upper.clamped(to: min...max)
        if lower > upper {
            swap(&lower, &upper)
        }
    }

    var label: String {
        "£\(lower) - £\(upper)"
    }
}

struct BeliefModel: Codable, Equatable {
    var estimatedReservationRange: IntBand
    var estimatedUrgency: Double
    var estimatedAlternatives: Double
    var collectedHints: [String]

    static func initial(for scenario: Scenario) -> BeliefModel {
        let spread = max(10_000, scenario.listingPrice / 8)
        let center = scenario.listingPrice - spread / 2

        return BeliefModel(
            estimatedReservationRange: IntBand(
                lower: max(0, center - spread),
                upper: center + spread
            ),
            estimatedUrgency: 0.35,
            estimatedAlternatives: scenario.knownFacts.hasCompetingViewingsSignal ? 0.62 : 0.38,
            collectedHints: []
        )
    }

    mutating func ingestHint(_ hint: String, reservationShift: Int = 0, urgencyShift: Double = 0, alternativesShift: Double = 0) {
        collectedHints.append(hint)
        estimatedReservationRange.lower += reservationShift
        estimatedReservationRange.upper += reservationShift
        estimatedUrgency = (estimatedUrgency + urgencyShift).clamped(to: 0...1)
        estimatedAlternatives = (estimatedAlternatives + alternativesShift).clamped(to: 0...1)
        estimatedReservationRange.clamp(min: 0, max: 2_000_000)
    }

    mutating func updateFromResponse(_ response: SellerResponse, listingPrice: Int) {
        switch response.type {
        case .counter:
            if let counter = response.counterPrice {
                let midpoint = (estimatedReservationRange.lower + estimatedReservationRange.upper) / 2
                let adjustment = Int(Double(counter - midpoint) * 0.25)
                estimatedReservationRange.lower += adjustment
                estimatedReservationRange.upper += adjustment
            }
            estimatedAlternatives = (estimatedAlternatives + 0.03).clamped(to: 0...1)
        case .reject:
            estimatedUrgency = (estimatedUrgency - 0.04).clamped(to: 0...1)
            estimatedAlternatives = (estimatedAlternatives + 0.05).clamped(to: 0...1)
            estimatedReservationRange.lower = min(estimatedReservationRange.lower + listingPrice / 100, estimatedReservationRange.upper)
        case .accept:
            estimatedUrgency = (estimatedUrgency + 0.08).clamped(to: 0...1)
            estimatedAlternatives = (estimatedAlternatives - 0.05).clamped(to: 0...1)
        case .withdraw:
            estimatedAlternatives = (estimatedAlternatives + 0.10).clamped(to: 0...1)
        case .callback:
            estimatedUrgency = (estimatedUrgency + 0.15).clamped(to: 0...1)
            estimatedAlternatives = (estimatedAlternatives - 0.08).clamped(to: 0...1)
        case .info:
            break
        }

        estimatedReservationRange.clamp(min: 0, max: 2_000_000)
    }
}
