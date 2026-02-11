import SwiftUI

struct MetersView: View {
    let meters: SoftMeters

    var body: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 12) {
                Text("Negotiation Signals")
                    .font(DesignSystem.Fonts.subheading)
                    .foregroundStyle(DesignSystem.Colors.bodyText)

                MeterBar(
                    title: "Momentum",
                    value: meters.momentum,
                    label: MeterStateLabel.momentum(meters.momentum),
                    color: DesignSystem.Colors.primary
                )

                MeterBar(
                    title: "Temperature",
                    value: meters.temperature,
                    label: MeterStateLabel.temperature(meters.temperature),
                    color: DesignSystem.Colors.warning
                )

                MeterBar(
                    title: "Trust",
                    value: meters.trust,
                    label: MeterStateLabel.trust(meters.trust),
                    color: DesignSystem.Colors.secondary
                )

                MeterBar(
                    title: "Urgency",
                    value: meters.urgency,
                    label: MeterStateLabel.urgency(meters.urgency),
                    color: DesignSystem.Colors.danger
                )
            }
        }
    }
}
