import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    let settings: AppSettings
    let onSave: (String, Difficulty, Bool) -> Void

    @State private var seedText: String
    @State private var difficulty: Difficulty
    @State private var tutorialEnabled: Bool

    init(settings: AppSettings, onSave: @escaping (String, Difficulty, Bool) -> Void) {
        self.settings = settings
        self.onSave = onSave

        _seedText = State(initialValue: String(settings.seed))
        _difficulty = State(initialValue: settings.difficulty)
        _tutorialEnabled = State(initialValue: settings.tutorialEnabled)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Simulation") {
                    TextField("Seed", text: $seedText)
                        .keyboardType(.numberPad)

                    Picker("Difficulty", selection: $difficulty) {
                        ForEach(Difficulty.allCases) { value in
                            Text(value.displayName).tag(value)
                        }
                    }
                }

                Section("Experience") {
                    Toggle("Tutorial enabled", isOn: $tutorialEnabled)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        onSave(seedText, difficulty, tutorialEnabled)
                        dismiss()
                    }
                }
            }
        }
    }
}
