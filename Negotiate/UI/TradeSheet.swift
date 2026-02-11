import SwiftUI

struct TradeSheet: View {
    @Environment(\.dismiss) private var dismiss

    let basePrice: Int
    let startingTerms: Terms
    let onSubmit: (Int, Terms) -> Void

    @State private var delta: Double = 0
    @State private var completionSpeed: CompletionSpeed
    @State private var fixtures: IncludedFixtures
    @State private var conditionalOnSurvey: Bool

    init(basePrice: Int, startingTerms: Terms, onSubmit: @escaping (Int, Terms) -> Void) {
        self.basePrice = basePrice
        self.startingTerms = startingTerms
        self.onSubmit = onSubmit
        _completionSpeed = State(initialValue: startingTerms.completionSpeed)
        _fixtures = State(initialValue: startingTerms.includedFixtures)
        _conditionalOnSurvey = State(initialValue: startingTerms.conditionalOnSurvey)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Price trade") {
                    Text("Delta: \(deltaText)")
                        .font(.title3.bold())
                        .foregroundStyle(DesignSystem.Colors.secondary)

                    Slider(value: $delta, in: -30_000...30_000, step: 500)

                    Text("Projected offer: £\(basePrice + Int(delta))")
                        .foregroundStyle(DesignSystem.Colors.secondaryText)
                }

                Section("Terms") {
                    Picker("Completion speed", selection: $completionSpeed) {
                        ForEach(CompletionSpeed.allCases) { value in
                            Text(value.displayName).tag(value)
                        }
                    }

                    Picker("Included fixtures", selection: $fixtures) {
                        ForEach(IncludedFixtures.allCases) { value in
                            Text(value.displayName).tag(value)
                        }
                    }

                    Toggle("Conditional on survey", isOn: $conditionalOnSurvey)
                }
            }
            .navigationTitle("Trade Terms")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Send") {
                        onSubmit(Int(delta), currentTerms)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var currentTerms: Terms {
        Terms(
            completionSpeed: completionSpeed,
            includedFixtures: fixtures,
            conditionalOnSurvey: conditionalOnSurvey
        )
    }

    private var deltaText: String {
        let number = Int(delta)
        return number >= 0 ? "+£\(number)" : "-£\(-number)"
    }
}
