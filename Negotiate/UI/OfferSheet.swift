import SwiftUI

struct OfferSheet: View {
    @Environment(\.dismiss) private var dismiss

    let listingPrice: Int
    let startingPrice: Int
    let startingTerms: Terms
    let onSubmit: (Int, Terms) -> Void

    @State private var offerPrice: Double
    @State private var completionSpeed: CompletionSpeed
    @State private var fixtures: IncludedFixtures
    @State private var conditionalOnSurvey: Bool

    init(listingPrice: Int, startingPrice: Int, startingTerms: Terms, onSubmit: @escaping (Int, Terms) -> Void) {
        self.listingPrice = listingPrice
        self.startingPrice = startingPrice
        self.startingTerms = startingTerms
        self.onSubmit = onSubmit

        _offerPrice = State(initialValue: Double(startingPrice))
        _completionSpeed = State(initialValue: startingTerms.completionSpeed)
        _fixtures = State(initialValue: startingTerms.includedFixtures)
        _conditionalOnSurvey = State(initialValue: startingTerms.conditionalOnSurvey)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Price") {
                    Text("£\(Int(offerPrice))")
                        .font(.title2.bold())
                        .foregroundStyle(DesignSystem.Colors.primary)

                    Slider(
                        value: $offerPrice,
                        in: Double(minPrice)...Double(maxPrice),
                        step: 500
                    )

                    Text("Listing: £\(listingPrice)")
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
            .navigationTitle("Make Offer")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Send") {
                        onSubmit(Int(offerPrice), currentTerms)
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

    private var minPrice: Int {
        max(0, Int(Double(listingPrice) * 0.55))
    }

    private var maxPrice: Int {
        Int(Double(listingPrice) * 1.10)
    }
}
