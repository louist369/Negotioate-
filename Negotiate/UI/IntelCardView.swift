import SwiftUI

struct IntelCardView: View {
    let belief: BeliefModel

    var body: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Label("Intel", systemImage: "person.text.rectangle")
                    .font(DesignSystem.Fonts.subheading)
                    .foregroundStyle(DesignSystem.Colors.bodyText)

                row(title: "Seller minimum likely", value: belief.estimatedReservationRange.label)
                row(title: "Estimated urgency", value: urgencyLabel(belief.estimatedUrgency))
                row(title: "Estimated alternatives", value: alternativesLabel(belief.estimatedAlternatives))

                if !belief.collectedHints.isEmpty {
                    Divider()
                        .overlay(DesignSystem.Colors.border)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Latest hints")
                            .font(.caption.bold())
                            .foregroundStyle(DesignSystem.Colors.secondaryText)
                        ForEach(Array(belief.collectedHints.suffix(3).enumerated()), id: \.offset) { _, hint in
                            Text("• \(hint)")
                                .font(.caption)
                                .foregroundStyle(DesignSystem.Colors.bodyText)
                        }
                    }
                }
            }
        }
    }

    private func row(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(DesignSystem.Colors.secondaryText)
            Spacer()
            Text(value)
                .foregroundStyle(DesignSystem.Colors.bodyText)
        }
        .font(.footnote)
    }

    private func urgencyLabel(_ value: Double) -> String {
        switch value {
        case ..<0.30: return "Low"
        case ..<0.60: return "Moderate"
        case ..<0.80: return "High"
        default: return "Severe"
        }
    }

    private func alternativesLabel(_ value: Double) -> String {
        switch value {
        case ..<0.30: return "Weak"
        case ..<0.60: return "Mixed"
        case ..<0.80: return "Strong"
        default: return "Very strong"
        }
    }
}
