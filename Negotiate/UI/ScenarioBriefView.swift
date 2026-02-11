import SwiftUI

struct ScenarioBriefView: View {
    let scenario: Scenario
    let onEnter: () -> Void
    var scenarioNamespace: Namespace.ID? = nil
    var scenarioCardID: String = "scenario-launch-card"

    var body: some View {
        ScrollView {
            VStack(spacing: DesignSystem.Spacing.sm) {
                headerCard

                CardContainer {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Known Facts")
                            .font(DesignSystem.Fonts.subheading)
                            .foregroundStyle(DesignSystem.Colors.bodyText)

                        factRow("Address", scenario.addressLabel)
                        factRow("Region", scenario.region.displayName)
                        factRow("Property", scenario.propertyType.displayName)
                        factRow("Days on market", "\(scenario.knownFacts.daysOnMarket)")
                        factRow(
                            "Chain status",
                            scenario.knownFacts.chainStatusKnown ? "Known" : "Unknown"
                        )
                        factRow(
                            "Viewings signal",
                            scenario.knownFacts.hasCompetingViewingsSignal ? "Active" : "Quiet"
                        )
                    }
                }

                Button(action: onEnter) {
                    Text("Enter Negotiation")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(DesignSystem.Colors.primary)
                        .foregroundStyle(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.control))
                }
            }
            .padding(DesignSystem.Spacing.sm)
        }
        .background(DesignSystem.Colors.background.ignoresSafeArea())
        .navigationTitle("Brief")
    }

    @ViewBuilder
    private var headerCard: some View {
        let card = CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Text("Scenario Brief")
                    .font(DesignSystem.Fonts.heading)
                    .foregroundStyle(DesignSystem.Colors.bodyText)

                Text(scenario.storyPrompt)
                    .foregroundStyle(DesignSystem.Colors.bodyText)

                Divider().overlay(DesignSystem.Colors.border)

                Text("Listing Price")
                    .font(.caption)
                    .foregroundStyle(DesignSystem.Colors.secondaryText)
                Text("£\(scenario.listingPrice)")
                    .font(.title2.bold())
                    .foregroundStyle(DesignSystem.Colors.primary)

                Text(scenario.objective)
                    .font(.subheadline)
                    .foregroundStyle(DesignSystem.Colors.secondary)
            }
        }

        if let scenarioNamespace {
            card
                .matchedGeometryEffect(id: scenarioCardID, in: scenarioNamespace)
        } else {
            card
        }
    }

    private func factRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(DesignSystem.Colors.secondaryText)
            Spacer()
            Text(value)
                .foregroundStyle(DesignSystem.Colors.bodyText)
        }
        .font(.footnote)
    }
}
