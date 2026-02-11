import SwiftUI

private struct RadarPolygonShape: Shape {
    let values: [Double]

    func path(in rect: CGRect) -> Path {
        guard values.count == 5 else { return Path() }

        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) * 0.37
        let points = values.enumerated().map { index, value in
            point(at: index, total: values.count, center: center, radius: radius * value.clamped(to: 0...1))
        }

        var path = Path()
        path.move(to: points[0])
        for point in points.dropFirst() {
            path.addLine(to: point)
        }
        path.closeSubpath()
        return path
    }

    private func point(at index: Int, total: Int, center: CGPoint, radius: Double) -> CGPoint {
        let angle = (Double(index) / Double(total)) * (Double.pi * 2) - Double.pi / 2
        return CGPoint(
            x: center.x + CGFloat(cos(angle) * radius),
            y: center.y + CGFloat(sin(angle) * radius)
        )
    }
}

struct RadarChartView: View {
    let scores: [Double]
    let labels: [String]

    @State private var progress: Double = 0

    var body: some View {
        GeometryReader { proxy in
            let rect = proxy.frame(in: .local)
            let center = CGPoint(x: rect.midX, y: rect.midY)
            let radius = min(rect.width, rect.height) * 0.37

            ZStack {
                ForEach(1...4, id: \.self) { ring in
                    RadarPolygonShape(values: Array(repeating: Double(ring) / 4.0, count: 5))
                        .stroke(DesignSystem.Colors.border, lineWidth: 1)
                }

                ForEach(0..<5, id: \.self) { index in
                    Path { path in
                        path.move(to: center)
                        path.addLine(to: axisPoint(index: index, center: center, radius: radius))
                    }
                    .stroke(DesignSystem.Colors.border.opacity(0.8), lineWidth: 1)
                }

                RadarPolygonShape(values: normalizedScores.map { $0 * progress })
                    .fill(DesignSystem.Colors.primary.opacity(0.30))

                RadarPolygonShape(values: normalizedScores.map { $0 * progress })
                    .stroke(DesignSystem.Colors.primary, lineWidth: 2)

                ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.caption2)
                        .foregroundStyle(DesignSystem.Colors.secondaryText)
                        .position(labelPoint(index: index, center: center, radius: radius + 20))
                        .multilineTextAlignment(.center)
                        .frame(width: 86)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(height: 260)
        .onAppear {
            progress = 0
            withAnimation(.spring(response: 0.8, dampingFraction: 0.75)) {
                progress = 1
            }
        }
    }

    private var normalizedScores: [Double] {
        guard scores.count == 5 else { return Array(repeating: 0, count: 5) }
        return scores.map { ($0 / 100.0).clamped(to: 0...1) }
    }

    private func axisPoint(index: Int, center: CGPoint, radius: CGFloat) -> CGPoint {
        let angle = (Double(index) / 5.0) * (Double.pi * 2) - Double.pi / 2
        return CGPoint(
            x: center.x + CGFloat(cos(angle)) * radius,
            y: center.y + CGFloat(sin(angle)) * radius
        )
    }

    private func labelPoint(index: Int, center: CGPoint, radius: CGFloat) -> CGPoint {
        let angle = (Double(index) / 5.0) * (Double.pi * 2) - Double.pi / 2
        return CGPoint(
            x: center.x + CGFloat(cos(angle)) * radius,
            y: center.y + CGFloat(sin(angle)) * radius
        )
    }
}
