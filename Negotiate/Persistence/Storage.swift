import Foundation

enum Difficulty: String, Codable, CaseIterable, Identifiable {
    case easy
    case standard
    case hard

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }
}

struct AppSettings: Codable, Equatable {
    var seed: UInt64
    var difficulty: Difficulty
    var tutorialEnabled: Bool

    static let `default` = AppSettings(seed: 42, difficulty: .standard, tutorialEnabled: true)
}

enum StorageError: Error {
    case appSupportUnavailable
    case decodeFailure
    case encodeFailure
}

final class Storage {
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let baseDirectoryOverride: URL?

    init(fileManager: FileManager = .default, baseDirectoryOverride: URL? = nil) {
        self.fileManager = fileManager
        self.baseDirectoryOverride = baseDirectoryOverride

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    func loadScenarios() throws -> [Scenario] {
        try load([Scenario].self, from: try scenariosURL)
    }

    func saveScenarios(_ scenarios: [Scenario]) throws {
        try save(scenarios, to: try scenariosURL)
    }

    func loadHistory() throws -> [RunHistoryItem] {
        let url = try self.historyURL
        if !fileManager.fileExists(atPath: url.path) {
            return []
        }
        return try load([RunHistoryItem].self, from: url)
    }

    func saveHistory(_ history: [RunHistoryItem]) throws {
        try save(history, to: try historyURL)
    }

    func loadSettings() throws -> AppSettings {
        let url = try self.settingsURL
        if !fileManager.fileExists(atPath: url.path) {
            return .default
        }
        return try load(AppSettings.self, from: url)
    }

    func saveSettings(_ settings: AppSettings) throws {
        try save(settings, to: try settingsURL)
    }

    func resetScenarioData() throws {
        let url = try self.scenariosURL
        if fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }

    func documentsSummaryForDebug() -> String {
        (try? applicationSupportDirectory.path) ?? "unavailable"
    }

    private func save<T: Codable>(_ payload: T, to url: URL) throws {
        do {
            let data = try encoder.encode(payload)
            try ensureAppSupportDirectory()
            try data.write(to: url, options: .atomic)
        } catch let error as EncodingError {
            throw error
        } catch {
            throw error
        }
    }

    private func load<T: Codable>(_ type: T.Type, from url: URL) throws -> T {
        do {
            let data = try Data(contentsOf: url)
            return try decoder.decode(T.self, from: data)
        } catch let error as DecodingError {
            throw error
        } catch {
            throw error
        }
    }

    private func ensureAppSupportDirectory() throws {
        try fileManager.createDirectory(at: applicationSupportDirectory, withIntermediateDirectories: true)
    }

    private var applicationSupportDirectory: URL {
        get throws {
            if let base = baseDirectoryOverride {
                if !fileManager.fileExists(atPath: base.path) {
                    try fileManager.createDirectory(at: base, withIntermediateDirectories: true)
                }
                return base
            }

            guard let url = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
                throw StorageError.appSupportUnavailable
            }
            let appFolder = url.appendingPathComponent("Negotiate", isDirectory: true)
            if !fileManager.fileExists(atPath: appFolder.path) {
                try fileManager.createDirectory(at: appFolder, withIntermediateDirectories: true)
            }
            return appFolder
        }
    }

    private var scenariosURL: URL {
        get throws {
            try applicationSupportDirectory.appendingPathComponent("scenarios.json", isDirectory: false)
        }
    }

    private var historyURL: URL {
        get throws {
            try applicationSupportDirectory.appendingPathComponent("history.json", isDirectory: false)
        }
    }

    private var settingsURL: URL {
        get throws {
            try applicationSupportDirectory.appendingPathComponent("settings.json", isDirectory: false)
        }
    }
}
