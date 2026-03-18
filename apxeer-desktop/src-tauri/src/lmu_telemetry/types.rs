#![allow(dead_code)]
#![allow(non_snake_case)]

// Rust translations of the LMU C++ shared memory structs.
//
// All structs use `#[repr(C, packed(4))]` to match the C++ `#pragma pack(push, 4)` directive
// used in InternalsPlugin.hpp and PluginObjects.hpp.
//
// Type mapping:
//   C++ `long`               → `i32`  (Windows long is always 32-bit)
//   C++ `unsigned long`      → `u32`
//   C++ `unsigned long long` → `u64`
//   C++ `bool`               → `u8`   (C++ bool is 1 byte; Rust bool has stricter validity)
//   C++ `char[N]`            → `[u8; N]`
//   C++ `HWND`               → `*mut core::ffi::c_void` (8 bytes on 64-bit Windows)
//   C++ `size_t`             → `usize` (8 bytes on 64-bit Windows)
//   C++ pointer fields       → raw pointers (never dereferenced from Rust)
use core::ffi::c_void;

// ─────────────────────────────────────────────────────────────────────────────
// Primitive vector / quaternion types
// ─────────────────────────────────────────────────────────────────────────────

/// 3D vector used throughout telemetry (24 bytes).
#[repr(C, packed(4))]
#[derive(Copy, Clone, Debug, Default)]
pub struct TelemVect3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Quaternion (32 bytes).
#[repr(C, packed(4))]
#[derive(Copy, Clone, Debug, Default)]
pub struct TelemQuat {
    pub w: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Wheel telemetry
// ─────────────────────────────────────────────────────────────────────────────

/// Per-wheel telemetry data.
///
/// C++ size: 232 bytes (with pack(4)).
#[repr(C, packed(4))]
#[derive(Copy, Clone)]
pub struct TelemWheelV01 {
    pub mSuspensionDeflection: f64,
    pub mRideHeight: f64,
    pub mSuspForce: f64,
    pub mBrakeTemp: f64,
    pub mBrakePressure: f64,

    pub mRotation: f64,
    pub mLateralPatchVel: f64,
    pub mLongitudinalPatchVel: f64,
    pub mLateralGroundVel: f64,
    pub mLongitudinalGroundVel: f64,
    pub mCamber: f64,
    pub mLateralForce: f64,
    pub mLongitudinalForce: f64,
    pub mTireLoad: f64,

    pub mGripFract: f64,
    pub mPressure: f64,
    /// Kelvin, left/center/right
    pub mTemperature: [f64; 3],
    pub mWear: f64,
    /// Material prefix from TDF file (16 bytes)
    pub mTerrainName: [u8; 16],
    /// 0=dry, 1=wet, 2=grass, 3=dirt, 4=gravel, 5=rumblestrip, 6=special
    pub mSurfaceType: u8,
    /// Whether tire is flat (stored as u8 to match C++ bool layout)
    pub mFlat: u8,
    /// Whether wheel is detached
    pub mDetached: u8,
    /// Tire radius in centimeters
    pub mStaticUndeflectedRadius: u8,

    pub mVerticalTireDeflection: f64,
    pub mWheelYLocation: f64,
    pub mToe: f64,

    pub mTireCarcassTemperature: f64,
    pub mTireInnerLayerTemperature: [f64; 3],

    pub mExpansion: [u8; 24],
}

impl Default for TelemWheelV01 {
    fn default() -> Self {
        // SAFETY: all-zero bytes are valid for this repr(C) struct
        unsafe { core::mem::zeroed() }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle telemetry
// ─────────────────────────────────────────────────────────────────────────────

/// Full telemetry for one vehicle.
///
/// C++ size: ~1408 bytes (with pack(4)).
#[repr(C, packed(4))]
#[derive(Copy, Clone)]
pub struct TelemInfoV01 {
    // Time
    pub mID: i32,
    pub mDeltaTime: f64,
    pub mElapsedTime: f64,
    pub mLapNumber: i32,
    pub mLapStartET: f64,
    pub mVehicleName: [u8; 64],
    pub mTrackName: [u8; 64],

    // Position and derivatives
    pub mPos: TelemVect3,
    pub mLocalVel: TelemVect3,
    pub mLocalAccel: TelemVect3,

    // Orientation and derivatives
    pub mOri: [TelemVect3; 3],
    pub mLocalRot: TelemVect3,
    pub mLocalRotAccel: TelemVect3,

    // Vehicle status
    pub mGear: i32,
    pub mEngineRPM: f64,
    pub mEngineWaterTemp: f64,
    pub mEngineOilTemp: f64,
    pub mClutchRPM: f64,

    // Driver input
    pub mUnfilteredThrottle: f64,
    pub mUnfilteredBrake: f64,
    pub mUnfilteredSteering: f64,
    pub mUnfilteredClutch: f64,

    // Filtered input
    pub mFilteredThrottle: f64,
    pub mFilteredBrake: f64,
    pub mFilteredSteering: f64,
    pub mFilteredClutch: f64,

    // Misc
    pub mSteeringShaftTorque: f64,
    pub mFront3rdDeflection: f64,
    pub mRear3rdDeflection: f64,

    // Aerodynamics
    pub mFrontWingHeight: f64,
    pub mFrontRideHeight: f64,
    pub mRearRideHeight: f64,
    pub mDrag: f64,
    pub mFrontDownforce: f64,
    pub mRearDownforce: f64,

    // State/damage info
    pub mFuel: f64,
    pub mEngineMaxRPM: f64,
    pub mScheduledStops: u8,
    pub mOverheating: u8,
    pub mDetached: u8,
    pub mHeadlights: u8,
    pub mDentSeverity: [u8; 8],
    pub mLastImpactET: f64,
    pub mLastImpactMagnitude: f64,
    pub mLastImpactPos: TelemVect3,

    // Expanded
    pub mEngineTorque: f64,
    pub mCurrentSector: i32,
    pub mSpeedLimiter: u8,
    pub mMaxGears: u8,
    pub mFrontTireCompoundIndex: u8,
    pub mRearTireCompoundIndex: u8,
    pub mFuelCapacity: f64,
    pub mFrontFlapActivated: u8,
    pub mRearFlapActivated: u8,
    pub mRearFlapLegalStatus: u8,
    pub mIgnitionStarter: u8,

    pub mFrontTireCompoundName: [u8; 18],
    pub mRearTireCompoundName: [u8; 18],

    pub mSpeedLimiterAvailable: u8,
    pub mAntiStallActivated: u8,
    pub mUnused: [u8; 2],
    pub mVisualSteeringWheelRange: f32,

    pub mRearBrakeBias: f64,
    pub mTurboBoostPressure: f64,
    pub mPhysicsToGraphicsOffset: [f32; 3],
    pub mPhysicalSteeringWheelRange: f32,

    pub mDeltaBest: f64,
    pub mBatteryChargeFraction: f64,

    // Electric boost motor
    pub mElectricBoostMotorTorque: f64,
    pub mElectricBoostMotorRPM: f64,
    pub mElectricBoostMotorTemperature: f64,
    pub mElectricBoostWaterTemperature: f64,
    pub mElectricBoostMotorState: u8,

    /// Future use: 111-8 = 103 bytes
    pub mExpansion: [u8; 103],

    // Wheel info: front-left, front-right, rear-left, rear-right
    pub mWheel: [TelemWheelV01; 4],
}

impl Default for TelemInfoV01 {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

/// Per-vehicle scoring information.
///
/// C++ size: ~392 bytes (with pack(4)).
#[repr(C, packed(4))]
#[derive(Copy, Clone)]
pub struct VehicleScoringInfoV01 {
    pub mID: i32,
    pub mDriverName: [u8; 32],
    pub mVehicleName: [u8; 64],
    pub mTotalLaps: i16,
    /// 0=sector3, 1=sector1, 2=sector2
    pub mSector: i8,
    /// 0=none, 1=finished, 2=dnf, 3=dq
    pub mFinishStatus: i8,
    pub mLapDist: f64,
    pub mPathLateral: f64,
    pub mTrackEdge: f64,

    pub mBestSector1: f64,
    pub mBestSector2: f64,
    pub mBestLapTime: f64,
    pub mLastSector1: f64,
    pub mLastSector2: f64,
    pub mLastLapTime: f64,
    pub mCurSector1: f64,
    pub mCurSector2: f64,

    pub mNumPitstops: i16,
    pub mNumPenalties: i16,
    pub mIsPlayer: u8,
    /// -1=nobody, 0=local player, 1=local AI, 2=remote, 3=replay
    pub mControl: i8,
    pub mInPits: u8,
    pub mPlace: u8,
    pub mVehicleClass: [u8; 32],

    // Dash indicators
    pub mTimeBehindNext: f64,
    pub mLapsBehindNext: i32,
    pub mTimeBehindLeader: f64,
    pub mLapsBehindLeader: i32,
    pub mLapStartET: f64,

    // Position and derivatives
    pub mPos: TelemVect3,
    pub mLocalVel: TelemVect3,
    pub mLocalAccel: TelemVect3,

    // Orientation and derivatives
    pub mOri: [TelemVect3; 3],
    pub mLocalRot: TelemVect3,
    pub mLocalRotAccel: TelemVect3,

    pub mHeadlights: u8,
    pub mPitState: u8,
    pub mServerScored: u8,
    pub mIndividualPhase: u8,

    pub mQualification: i32,

    pub mTimeIntoLap: f64,
    pub mEstimatedLapTime: f64,

    pub mPitGroup: [u8; 24],
    pub mFlag: u8,
    pub mUnderYellow: u8,
    pub mCountLapFlag: u8,
    pub mInGarageStall: u8,

    pub mUpgradePack: [u8; 16],
    pub mPitLapDist: f32,

    pub mBestLapSector1: f32,
    pub mBestLapSector2: f32,

    pub mSteamID: u64,

    pub mVehFilename: [u8; 32],

    pub mAttackMode: i16,
    pub mFuelFraction: u8,
    pub mDRSState: u8,

    pub mExpansion: [u8; 4],
}

impl Default for VehicleScoringInfoV01 {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

/// Session scoring information.
///
/// Contains raw pointer fields (`mResultsStream`, `mVehicle`) that are part of the
/// C++ struct layout. These are never dereferenced from Rust — they exist only to
/// maintain correct byte offsets for subsequent fields.
///
/// C++ size: ~784 bytes (with pack(4)).
#[repr(C, packed(4))]
pub struct ScoringInfoV01 {
    pub mTrackName: [u8; 64],
    pub mSession: i32,
    pub mCurrentET: f64,
    pub mEndET: f64,
    pub mMaxLaps: i32,
    pub mLapDist: f64,
    /// Raw pointer — do not dereference from Rust (points into shared memory)
    pub mResultsStream: *mut u8,

    pub mNumVehicles: i32,

    pub mGamePhase: u8,
    pub mYellowFlagState: i8,
    pub mSectorFlag: [i8; 3],
    pub mStartLight: u8,
    pub mNumRedLights: u8,
    pub mInRealtime: u8,
    pub mPlayerName: [u8; 32],
    pub mPlrFileName: [u8; 64],

    // Weather
    pub mDarkCloud: f64,
    pub mRaining: f64,
    pub mAmbientTemp: f64,
    pub mTrackTemp: f64,
    pub mWind: TelemVect3,
    pub mMinPathWetness: f64,
    pub mMaxPathWetness: f64,

    // Multiplayer
    pub mGameMode: u8,
    pub mIsPasswordProtected: u8,
    pub mServerPort: u16,
    pub mServerPublicIP: u32,
    pub mMaxPlayers: i32,
    pub mServerName: [u8; 32],
    pub mStartET: f32,

    pub mAvgPathWetness: f64,

    pub mExpansion: [u8; 200],

    /// 4 bytes of padding: MSVC keeps pointer alignment at 8 bytes even with
    /// #pragma pack(4) on 64-bit Windows, so there is implicit padding before mVehicle.
    pub _pad_before_vehicle: [u8; 4],

    /// Raw pointer — do not dereference from Rust (points into shared memory)
    pub mVehicle: *mut VehicleScoringInfoV01,
}

impl Default for ScoringInfoV01 {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

// SAFETY: ScoringInfoV01 contains raw pointers but is only used as a value type
// copied from shared memory. The pointers are never dereferenced.
unsafe impl Send for ScoringInfoV01 {}
unsafe impl Sync for ScoringInfoV01 {}

// ─────────────────────────────────────────────────────────────────────────────
// Application state
// ─────────────────────────────────────────────────────────────────────────────

/// Application/window state.
///
/// C++ size: 260 bytes (with pack(4)).
/// HWND(8) + 4×u32(16) + u8(1) + [u8;31](31) + [u8;204](204) = 260
#[repr(C, packed(4))]
pub struct ApplicationStateV01 {
    /// Application window handle — do not use from Rust
    pub mAppWindow: *mut c_void,
    pub mWidth: u32,
    pub mHeight: u32,
    pub mRefreshRate: u32,
    pub mWindowed: u32,
    /// 0=main UI, 1=track loading, 2=monitor, 3=on track
    pub mOptionsLocation: u8,
    pub mOptionsPage: [u8; 31],
    pub mExpansion: [u8; 204],
}

impl Default for ApplicationStateV01 {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

// SAFETY: ApplicationStateV01 contains a raw HWND pointer but is only used as
// a value type copied from shared memory. The pointer is never dereferenced.
unsafe impl Send for ApplicationStateV01 {}
unsafe impl Sync for ApplicationStateV01 {}

// ─────────────────────────────────────────────────────────────────────────────
// Shared memory event enum
// ─────────────────────────────────────────────────────────────────────────────

/// Shared memory event indices (matches C++ `SharedMemoryEvent` enum).
pub mod shared_memory_event {
    pub const SME_ENTER: usize = 0;
    pub const SME_EXIT: usize = 1;
    pub const SME_STARTUP: usize = 2;
    pub const SME_SHUTDOWN: usize = 3;
    pub const SME_LOAD: usize = 4;
    pub const SME_UNLOAD: usize = 5;
    pub const SME_START_SESSION: usize = 6;
    pub const SME_END_SESSION: usize = 7;
    pub const SME_ENTER_REALTIME: usize = 8;
    pub const SME_EXIT_REALTIME: usize = 9;
    pub const SME_UPDATE_SCORING: usize = 10;
    pub const SME_UPDATE_TELEMETRY: usize = 11;
    pub const SME_INIT_APPLICATION: usize = 12;
    pub const SME_UNINIT_APPLICATION: usize = 13;
    pub const SME_SET_ENVIRONMENT: usize = 14;
    pub const SME_FFB: usize = 15;
    pub const SME_MAX: usize = 16;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared memory top-level structs
// ─────────────────────────────────────────────────────────────────────────────

/// Generic/global shared memory data.
///
/// Note: `long` in C++ on Windows is 32-bit → `i32`.
/// `SharedMemoryEvent` enum values are `uint32_t` → `u32`.
#[repr(C, packed(4))]
pub struct SharedMemoryGeneric {
    /// Event flags array — index with `shared_memory_event::SME_*` constants
    pub events: [u32; shared_memory_event::SME_MAX],
    pub gameVersion: i32,
    pub FFBTorque: f32,
    pub appInfo: ApplicationStateV01,
}

impl Default for SharedMemoryGeneric {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

unsafe impl Send for SharedMemoryGeneric {}
unsafe impl Sync for SharedMemoryGeneric {}

/// Path data (5 × MAX_PATH = 5 × 260 bytes = 1300 bytes).
#[repr(C, packed(4))]
#[derive(Copy, Clone)]
pub struct SharedMemoryPathData {
    pub userData: [u8; 260],
    pub customVariables: [u8; 260],
    pub stewardResults: [u8; 260],
    pub playerProfile: [u8; 260],
    pub pluginsFolder: [u8; 260],
}

impl Default for SharedMemoryPathData {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

/// Scoring data including up to 104 vehicles and a results stream buffer.
#[repr(C, packed(4))]
pub struct SharedMemoryScoringData {
    pub scoringInfo: ScoringInfoV01,
    pub scoringStreamSize: usize,
    /// MUST NOT BE MOVED — fixed position in shared memory layout
    pub vehScoringInfo: [VehicleScoringInfoV01; 104],
    pub scoringStream: [u8; 65536],
}

impl Default for SharedMemoryScoringData {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

unsafe impl Send for SharedMemoryScoringData {}
unsafe impl Sync for SharedMemoryScoringData {}

/// Telemetry data for up to 104 vehicles.
///
/// Note: C++ spelling is "Telemtry" (typo preserved from original header).
#[repr(C, packed(4))]
pub struct SharedMemoryTelemtryData {
    pub active_vehicles: u8,
    pub player_vehicle_idx: u8,
    pub player_has_vehicle: u8,
    pub telem_info: [TelemInfoV01; 104],
}

impl Default for SharedMemoryTelemtryData {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

/// Top-level shared memory object containing all data sections.
///
/// This is a very large struct (~190 KB+). Always heap-allocate with `Box`.
#[repr(C, packed(4))]
pub struct SharedMemoryObjectOut {
    pub generic: SharedMemoryGeneric,
    pub paths: SharedMemoryPathData,
    pub scoring: SharedMemoryScoringData,
    pub telemetry: SharedMemoryTelemtryData,
}

impl Default for SharedMemoryObjectOut {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

unsafe impl Send for SharedMemoryObjectOut {}
unsafe impl Sync for SharedMemoryObjectOut {}

/// The shared memory layout — a thin wrapper around `SharedMemoryObjectOut`.
#[repr(C, packed(4))]
pub struct SharedMemoryLayout {
    pub data: SharedMemoryObjectOut,
}

impl Default for SharedMemoryLayout {
    fn default() -> Self {
        unsafe { core::mem::zeroed() }
    }
}

unsafe impl Send for SharedMemoryLayout {}
unsafe impl Sync for SharedMemoryLayout {}

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time size assertions
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod size_tests {
    use super::*;
    use core::mem::size_of;

    #[test]
    fn telem_vect3_size() {
        assert_eq!(size_of::<TelemVect3>(), 24, "TelemVect3 must be 24 bytes");
    }

    #[test]
    fn telem_quat_size() {
        assert_eq!(size_of::<TelemQuat>(), 32, "TelemQuat must be 32 bytes");
    }

    #[test]
    fn telem_wheel_size() {
        // With pack(4), total layout:
        // 5+9+2+3+1 doubles = 20×8=160, [u8;16]=16, 4×u8=4, 3+1+3 doubles=7×8=56, [u8;24]=24
        // = 160+16+4+56+24 = 260 bytes
        assert_eq!(
            size_of::<TelemWheelV01>(),
            260,
            "TelemWheelV01 must be 260 bytes"
        );
    }

    #[test]
    fn application_state_size() {
        // HWND(8) + 4×u32(16) + u8(1) + [u8;31](31) + [u8;204](204) = 260
        assert_eq!(
            size_of::<ApplicationStateV01>(),
            260,
            "ApplicationStateV01 must be 260 bytes"
        );
    }

    #[test]
    fn shared_memory_path_data_size() {
        assert_eq!(
            size_of::<SharedMemoryPathData>(),
            1300,
            "SharedMemoryPathData must be 1300 bytes (5 × MAX_PATH)"
        );
    }

    #[test]
    fn print_key_struct_sizes() {
        // Print sizes so we can compare with C++ output
        println!(
            "TelemVect3              = {} bytes",
            size_of::<TelemVect3>()
        );
        println!(
            "TelemWheelV01           = {} bytes",
            size_of::<TelemWheelV01>()
        );
        println!(
            "TelemInfoV01            = {} bytes",
            size_of::<TelemInfoV01>()
        );
        println!(
            "VehicleScoringInfoV01   = {} bytes",
            size_of::<VehicleScoringInfoV01>()
        );
        println!(
            "ScoringInfoV01          = {} bytes",
            size_of::<ScoringInfoV01>()
        );
        println!(
            "ApplicationStateV01     = {} bytes",
            size_of::<ApplicationStateV01>()
        );
        println!(
            "SharedMemoryGeneric     = {} bytes",
            size_of::<SharedMemoryGeneric>()
        );
        println!(
            "SharedMemoryPathData    = {} bytes",
            size_of::<SharedMemoryPathData>()
        );
        println!(
            "SharedMemoryScoringData = {} bytes",
            size_of::<SharedMemoryScoringData>()
        );
        println!(
            "SharedMemoryTelemtryData= {} bytes",
            size_of::<SharedMemoryTelemtryData>()
        );
        println!(
            "SharedMemoryObjectOut   = {} bytes",
            size_of::<SharedMemoryObjectOut>()
        );
        println!(
            "SharedMemoryLayout      = {} bytes",
            size_of::<SharedMemoryLayout>()
        );
    }
}
