import SwiftUI

struct HistoryView: View {
    let runs: [RunHistoryItem]
    var scenarioNamespace: Namespace.ID? = nil
    var scenarioCardID: String = "scenario-launch-card"

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if runs.isEmpty {
                    CardContainer {
                        Text("No runs yet. Start a negotiation to build history.")
                            .foregroundStyle(DesignSystem.Colors.secondaryText)
                    }
                } else {
                    ForEach(Array(runs.enumerated()), id: \.element.id) { index, run in
                        historyCard(for: run)
                            .modifier(FirstCardMatchModifier(
                                shouldMatch: index == 0,
                                namespace: scenarioNamespace,
                                cardID: scenarioCardID
                            ))
                    }
                }
            }
            .padding(DesignSystem.Spacing.sm)
        }
        .background(DesignSystem.Colors.background.ignoresSafeArea())
        .navigationTitle("History")
    }

    private func historyCard(for run: RunHistoryItem) -> some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 8) {
                Text(run.scenarioTitle)
                    .font(.headline)
                    .foregroundStyle(DesignSystem.Colors.bodyText)

                HStack {
                    Text(outcomeText(run.outcome.result))
                        .foregroundStyle(outcomeColor(run.outcome.result))
                    Spacer()
                    Text(run.endedAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption)
                        .foregroundStyle(DesignSystem.Colors.secondaryText)
                }

                HStack {
                    Text("Listing: £\(run.listingPrice)")
                    Spacer()
                    Text("Resolved: Day \(run.outcome.dayResolved)")
                }
                .font(.caption)
                .foregroundStyle(DesignSystem.Colors.secondaryText)

                HStack {
                    Text("NCI")
                    Spacer()
                    Text(String(format: "%+.1f", run.debrief.nciDelta))
                        .foregroundStyle(run.debrief.nciDelta >= 0 ? DesignSystem.Colors.primary : DesignSystem.Colors.danger)
                }
                .font(.subheadline.bold())
                .foregroundStyle(DesignSystem.Colors.bodyText)
            }
        }
    }

    private func outcomeText(_ result: NegotiationResultType) -> String {
        switch result {
        case .dealReached: return "Deal reached"
        case .sellerWithdrew: return "Seller withdrew"
        case .buyerWalkedAway: return "Walked away"
        case .timeout: return "Timed out"
        }
    }

    private func outcomeColor(_ result: NegotiationResultType) -> Color {
        switch result {
        case .dealReached: return DesignSystem.Colors.primary
        case .buyerWalkedAway: return DesignSystem.Colors.warning
        case .sellerWithdrew, .timeout: return DesignSystem.Colors.danger
        }
    }
}

private struct FirstCardMatchModifier: ViewModifier {
    let shouldMatch: Bool
    let namespace: Namespace.ID?
    let cardID: String

    func body(content: Content) -> some View {
        if shouldMatch, let namespace {
            content.matchedGeometryEffect(id: cardID, in: namespace)
        } else {
            content
        }
    }
}
