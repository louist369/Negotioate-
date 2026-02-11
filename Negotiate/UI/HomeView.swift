import SwiftUI

struct HomeView: View {
    let nci: Double
    let hasHistory: Bool
    let onNewNegotiation: () -> Void
    let onOpenHistory: () -> Void
    let onOpenSettings: () -> Void
    var scenarioNamespace: Namespace.ID? = nil
    var scenarioCardID: String = "scenario-launch-card"

    var body: some View {
        ScrollView {
            VStack(spacing: DesignSystem.Spacing.md) {
                VStack(alignment: .leading, spacing: DesignSystem.Spacing.xs) {
                    Text("Negotiate")
                        .font(.largeTitle.bold())
                        .foregroundStyle(DesignSystem.Colors.bodyText)
                    Text("Offline negotiation simulator")
                        .foregroundStyle(DesignSystem.Colors.secondaryText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if hasHistory {
                    CardContainer {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Negotiator Confidence Index")
                                .font(DesignSystem.Fonts.subheading)
                                .foregroundStyle(DesignSystem.Colors.bodyText)
                            Text(String(format: "%.1f", nci.clamped(to: 0...100)))
                                .font(.system(size: 36, weight: .bold, design: .rounded))
                                .foregroundStyle(DesignSystem.Colors.secondary)

                            RankBadge(nci: nci)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                VStack(spacing: 12) {
                    launchCard

                    GameCard(
                        title: "History",
                        subtitle: "Review outcomes and NCI progression",
                        icon: "clock.arrow.circlepath",
                        accent: DesignSystem.Colors.secondary,
                        action: onOpenHistory
                    )

                    GameCard(
                        title: "Settings",
                        subtitle: "Adjust seed, difficulty, and tutorial",
                        icon: "slider.horizontal.3",
                        accent: DesignSystem.Colors.warning,
                        action: onOpenSettings
                    )
                }
            }
            .padding(DesignSystem.Spacing.sm)
        }
        .background(DesignSystem.Colors.background.ignoresSafeArea())
    }

    @ViewBuilder
    private var launchCard: some View {
        if let scenarioNamespace {
            GameCard(
                title: "New Negotiation",
                subtitle: "Jump into a fresh UK housing scenario",
                icon: "house.fill",
                accent: DesignSystem.Colors.primary
            ) {
                withAnimation(DesignSystem.Animation.springDefault) {
                    onNewNegotiation()
                }
            }
            .matchedGeometryEffect(id: scenarioCardID, in: scenarioNamespace)
        } else {
            GameCard(
                title: "New Negotiation",
                subtitle: "Jump into a fresh UK housing scenario",
                icon: "house.fill",
                accent: DesignSystem.Colors.primary
            ) {
                withAnimation(DesignSystem.Animation.springDefault) {
                    onNewNegotiation()
                }
            }
        }
    }
}
