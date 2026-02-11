import SwiftUI

struct MeterBar: View {
    let title: String
    let value: Double
    let label: String
    let color: Color

    @State private var glowOpacity: Double = 0
    @State private var isPulsing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.caption.bold())
                    .foregroundStyle(DesignSystem.Colors.bodyText)
                Spacer()
                Text(label)
                    .font(.caption)
                    .foregroundStyle(DesignSystem.Colors.secondaryText)
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(DesignSystem.Colors.border)

                    RoundedRectangle(cornerRadius: 6)
                        .fill(color)
                        .frame(width: proxy.size.width * value.clamped(to: 0...1))

                    RoundedRectangle(cornerRadius: 6)
                        .fill(color.opacity(glowOpacity))
                        .frame(width: proxy.size.width * value.clamped(to: 0...1))
                        .shadow(
                            color: DesignSystem.Shadow.glowPulse(for: color).color,
                            radius: DesignSystem.Shadow.glowPulse(for: color).radius,
                            x: DesignSystem.Shadow.glowPulse(for: color).x,
                            y: DesignSystem.Shadow.glowPulse(for: color).y
                        )
                }
                .animation(DesignSystem.Animation.meterChange, value: value)
            }
            .frame(height: 10)
        }
        .onChange(of: value) { oldValue, newValue in
            let delta = abs(newValue - oldValue)
            guard delta > 0.15, !isPulsing else { return }
            triggerPulse()
        }
    }

    private func triggerPulse() {
        isPulsing = true
        withAnimation(.easeOut(duration: 0.20)) {
            glowOpacity = 0.30
        }
        withAnimation(.easeOut(duration: 0.40).delay(0.20)) {
            glowOpacity = 0.0
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            isPulsing = false
        }
    }
}
