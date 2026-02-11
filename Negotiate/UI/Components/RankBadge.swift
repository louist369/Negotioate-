import SwiftUI

struct NCIRank: Equatable {
    let title: String
    let lowerBound: Double
    let upperBound: Double

    static let tiers: [NCIRank] = [
        NCIRank(title: "Novice", lowerBound: 0, upperBound: 20),
        NCIRank(title: "Apprentice", lowerBound: 21, upperBound: 40),
        NCIRank(title: "Negotiator", lowerBound: 41, upperBound: 60),
        NCIRank(title: "Strategist", lowerBound: 61, upperBound: 80),
        NCIRank(title: "Master Dealmaker", lowerBound: 81, upperBound: 100)
    ]

    static func rank(for nci: Double) -> NCIRank {
        tiers.first(where: { nci >= $0.lowerBound && nci <= $0.upperBound }) ?? tiers[0]
    }

    func nextThreshold() -> Double? {
        guard let currentIndex = Self.tiers.firstIndex(of: self), currentIndex < Self.tiers.count - 1 else {
            return nil
        }
        return Self.tiers[currentIndex + 1].lowerBound
    }

    func normalizedProgress(for nci: Double) -> Double {
        if let next = nextThreshold() {
            let span = max(1, next - lowerBound)
            return ((nci - lowerBound) / span).clamped(to: 0...1)
        }
        return 1
    }
}

struct RankBadge: View {
    let nci: Double
    @State private var animatedProgress: Double = 0

    private var rank: NCIRank {
        NCIRank.rank(for: nci)
    }

    private var progress: Double {
        rank.normalizedProgress(for: nci)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "medal.fill")
                    .foregroundStyle(Color.black)
                Text(rank.title)
                    .font(.caption.bold())
                    .foregroundStyle(Color.black)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(DesignSystem.Colors.secondary)
            .clipShape(Capsule())

            VStack(alignment: .leading, spacing: 6) {
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(DesignSystem.Colors.border)
                        .frame(height: 8)

                    RoundedRectangle(cornerRadius: 5)
                        .fill(DesignSystem.Colors.secondary)
                        .frame(width: max(8, animatedProgress * 210), height: 8)
                }
                .frame(width: 210, alignment: .leading)

                Text(progressLabel)
                    .font(.caption2)
                    .foregroundStyle(DesignSystem.Colors.secondaryText)
            }
        }
        .onAppear {
            animatedProgress = 0
            withAnimation(.easeOut(duration: 0.6)) {
                animatedProgress = progress
            }
        }
        .onChange(of: nci) { _, _ in
            withAnimation(.easeOut(duration: 0.6)) {
                animatedProgress = progress
            }
        }
    }

    private var progressLabel: String {
        if let next = rank.nextThreshold() {
            return "Progress to next rank: \(Int(nci.clamped(to: 0...100)))/\(Int(next))"
        }
        return "Top rank achieved"
    }
}
