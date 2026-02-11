import SwiftUI

struct DebriefView: View {
    let report: DebriefReport
    let outcome: NegotiationOutcome
    let onDone: () -> Void

    @State private var animatedReservation: Double = 0
    @State private var showPsychologyStep = false
    @State private var animatedEgo: Double = 0
    @State private var animatedUrgency: Double = 0
    @State private var showValueLeft = false

    var body: some View {
        ScrollView {
            VStack(spacing: DesignSystem.Spacing.sm) {
                CardContainer {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Debrief")
                            .font(DesignSystem.Fonts.heading)
                            .foregroundStyle(DesignSystem.Colors.bodyText)

                        Label(outcomeLabel, systemImage: outcomeIcon)
                            .foregroundStyle(outcomeColor)
                            .font(.headline)

                        Text(report.whyItHappened)
                            .foregroundStyle(DesignSystem.Colors.bodyText)
                    }
                }

                hiddenVariableReveal

                if showPsychologyStep {
                    CardContainer {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Psychological Pressure")
                                .font(DesignSystem.Fonts.subheading)
                                .foregroundStyle(DesignSystem.Colors.bodyText)

                            revealBar(title: "Ego Sensitivity", value: animatedEgo, tint: DesignSystem.Colors.warning)
                            revealBar(title: "Urgency Curve", value: animatedUrgency, tint: DesignSystem.Colors.danger)
                        }
                    }
                    .transition(.opacity)
                }

                if showValueLeft {
                    CardContainer {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Value Left on Table")
                                .font(DesignSystem.Fonts.subheading)
                                .foregroundStyle(DesignSystem.Colors.bodyText)

                            Text("£\(valueLeftOnTable)")
                                .font(.system(size: 40, weight: .bold, design: .rounded))
                                .foregroundStyle(valueLeftColor)

                            Text(valueLeftCaption)
                                .font(.caption)
                                .foregroundStyle(DesignSystem.Colors.secondaryText)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .transition(.opacity)
                }

                CardContainer {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("NCI Radar")
                            .font(DesignSystem.Fonts.subheading)
                            .foregroundStyle(DesignSystem.Colors.secondary)

                        RadarChartView(
                            scores: [
                                report.scores.anchoring,
                                report.scores.concessionDiscipline,
                                report.scores.informationExtraction,
                                report.scores.emotionalControl,
                                report.scores.walkAwayTiming
                            ],
                            labels: [
                                "Anchoring",
                                "Concession",
                                "Info",
                                "Emotion",
                                "Walk-away"
                            ]
                        )

                        scoreRow("Anchoring", report.scores.anchoring)
                        scoreRow("Concession discipline", report.scores.concessionDiscipline)
                        scoreRow("Information extraction", report.scores.informationExtraction)
                        scoreRow("Emotional control", report.scores.emotionalControl)
                        scoreRow("Walk-away timing", report.scores.walkAwayTiming)

                        Divider().overlay(DesignSystem.Colors.border)

                        HStack {
                            Text("NCI Delta")
                            Spacer()
                            Text(String(format: "%+.1f", report.nciDelta))
                                .foregroundStyle(report.nciDelta >= 0 ? DesignSystem.Colors.primary : DesignSystem.Colors.danger)
                        }
                        .foregroundStyle(DesignSystem.Colors.bodyText)

                        HStack {
                            Text("Current NCI")
                            Spacer()
                            Text(String(format: "%.1f", report.resultingNCI))
                                .foregroundStyle(DesignSystem.Colors.secondary)
                        }
                        .font(.headline)
                        .foregroundStyle(DesignSystem.Colors.bodyText)
                    }
                }

                CardContainer {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("What Worked")
                            .font(DesignSystem.Fonts.subheading)
                            .foregroundStyle(DesignSystem.Colors.primary)

                        ForEach(report.whatWorked, id: \.self) { item in
                            AdvisorTipCard(text: item, isPositive: true)
                        }

                        Divider().overlay(DesignSystem.Colors.border)

                        Text("What Cost You Value")
                            .font(DesignSystem.Fonts.subheading)
                            .foregroundStyle(DesignSystem.Colors.warning)

                        ForEach(report.whatCostValue, id: \.self) { item in
                            AdvisorTipCard(text: item, isPositive: false)
                        }
                    }
                }

                Button(action: onDone) {
                    Text("Back to Home")
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
        .navigationTitle("Debrief")
        .navigationBarBackButtonHidden(true)
        .task(id: report.revealedReservationValue) {
            await runRevealSequence()
        }
    }

    private var hiddenVariableReveal: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 8) {
                Text("Seller's True Bottom Line")
                    .font(DesignSystem.Fonts.subheading)
                    .foregroundStyle(DesignSystem.Colors.bodyText)

                Text("£\(Int(animatedReservation))")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .foregroundStyle(DesignSystem.Colors.primary)

                valueRow("Seller desired target", "£\(report.revealedTargetValue)")
                valueRow("Alternatives strength", percent(report.revealedAlternativesStrength))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var outcomeLabel: String {
        switch outcome.result {
        case .dealReached: return "Deal Reached"
        case .sellerWithdrew: return "Seller Withdrew"
        case .buyerWalkedAway: return "Walked Away"
        case .timeout: return "Timed Out"
        }
    }

    private var outcomeIcon: String {
        switch outcome.result {
        case .dealReached: return "checkmark.circle.fill"
        case .sellerWithdrew, .timeout: return "xmark.circle.fill"
        case .buyerWalkedAway: return "figure.walk.motion"
        }
    }

    private var outcomeColor: Color {
        switch outcome.result {
        case .dealReached: return DesignSystem.Colors.primary
        case .buyerWalkedAway: return DesignSystem.Colors.warning
        case .sellerWithdrew, .timeout: return DesignSystem.Colors.danger
        }
    }

    private var valueLeftOnTable: Int {
        if let accepted = outcome.acceptedPrice {
            return max(0, accepted - report.revealedReservationValue)
        }
        return max(0, report.revealedTargetValue - report.revealedReservationValue)
    }

    private var valueLeftRatio: Double {
        Double(valueLeftOnTable) / Double(max(1, report.revealedReservationValue))
    }

    private var valueLeftColor: Color {
        switch valueLeftRatio {
        case ...0.05:
            return DesignSystem.Colors.primary
        case ...0.15:
            return DesignSystem.Colors.warning
        default:
            return DesignSystem.Colors.danger
        }
    }

    private var valueLeftCaption: String {
        String(format: "%.1f%% of reservation", valueLeftRatio * 100)
    }

    private func valueRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(DesignSystem.Colors.secondaryText)
            Spacer()
            Text(value)
                .foregroundStyle(DesignSystem.Colors.bodyText)
        }
        .font(.footnote)
    }

    private func scoreRow(_ label: String, _ value: Double) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(DesignSystem.Colors.secondaryText)
            Spacer()
            Text(String(format: "%.0f", value))
                .foregroundStyle(DesignSystem.Colors.bodyText)
        }
        .font(.footnote)
    }

    private func percent(_ value: Double) -> String {
        "\(Int(value * 100))%"
    }

    private func revealBar(title: String, value: Double, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(DesignSystem.Colors.secondaryText)
                Spacer()
                Text(percent(value))
                    .font(.caption.bold())
                    .foregroundStyle(DesignSystem.Colors.bodyText)
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(DesignSystem.Colors.border)

                    RoundedRectangle(cornerRadius: 6)
                        .fill(tint)
                        .frame(width: proxy.size.width * value.clamped(to: 0...1))
                }
            }
            .frame(height: 10)
        }
    }

    @MainActor
    private func runRevealSequence() async {
        animatedReservation = 0
        animatedEgo = 0
        animatedUrgency = 0
        showPsychologyStep = false
        showValueLeft = false

        withAnimation(DesignSystem.Animation.revealSequence) {
            animatedReservation = Double(report.revealedReservationValue)
        }

        try? await Task.sleep(for: .milliseconds(1700))

        withAnimation(.easeOut(duration: 0.2)) {
            showPsychologyStep = true
        }
        withAnimation(.easeOut(duration: 0.8)) {
            animatedEgo = report.revealedEgoSensitivity
            animatedUrgency = report.revealedUrgencyCurve
        }

        try? await Task.sleep(for: .milliseconds(650))

        withAnimation(.easeOut(duration: 0.35)) {
            showValueLeft = true
        }
    }
}
