import SwiftUI

struct AskSheet: View {
    @Environment(\.dismiss) private var dismiss

    let onSubmit: (AskQuestion) -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(AskQuestion.allCases) { question in
                    Button {
                        onSubmit(question)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(question.rawValue)
                                .foregroundStyle(DesignSystem.Colors.bodyText)

                            Text(subtitle(for: question))
                                .font(.caption)
                                .foregroundStyle(DesignSystem.Colors.secondaryText)
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
            .navigationTitle("Ask Seller")
            .scrollContentBackground(.hidden)
            .background(DesignSystem.Colors.background)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func subtitle(for question: AskQuestion) -> String {
        switch question {
        case .timeline:
            return "Reveal timeline pressure hints."
        case .alternatives:
            return "Probe competing buyer strength."
        case .flexibility:
            return "Test ego and concession posture."
        }
    }
}
