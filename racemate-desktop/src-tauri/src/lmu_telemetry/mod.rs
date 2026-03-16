/// LMU shared memory reader.
///
/// Reads the `LMU_Data` Windows shared memory file produced by Le Mans Ultimate.
/// Uses the `SharedMemoryLock` (over `LMU_SharedMemoryLockData`) to avoid torn reads.
///
/// # Usage
///
/// ```text
/// match lmu_telemetry::read_telemetry() {
///     Ok(data) => {
///         let active = data.telemetry.active_vehicles;
///         // ...
///     }
///     Err(e) => eprintln!("Error: {}", e),
/// }
/// ```
pub mod types;

pub use types::*;

use std::mem::size_of;
use std::ptr;
use std::sync::atomic::{AtomicI32, Ordering};

use winapi::shared::minwindef::FALSE;
use winapi::shared::winerror::ERROR_ALREADY_EXISTS;
use winapi::um::errhandlingapi::GetLastError;
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::memoryapi::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_ALL_ACCESS, FILE_MAP_READ,
};
use winapi::um::synchapi::{CreateEventA, SetEvent, WaitForSingleObject};
use winapi::um::winbase::{CreateFileMappingA, INFINITE};
use winapi::um::winnt::{HANDLE, PAGE_READWRITE};

// ─────────────────────────────────────────────────────────────────────────────
// Shared memory names
// ─────────────────────────────────────────────────────────────────────────────

const LMU_SHARED_MEMORY_FILE: &str = "LMU_Data";
const LMU_LOCK_DATA_NAME: &[u8] = b"LMU_SharedMemoryLockData\0";
const LMU_LOCK_EVENT_NAME: &[u8] = b"LMU_SharedMemoryLockEvent\0";

// ─────────────────────────────────────────────────────────────────────────────
// SharedMemoryLock — mirrors the C++ SharedMemoryLock class
// ─────────────────────────────────────────────────────────────────────────────

/// Internal lock data layout in the `LMU_SharedMemoryLockData` mapping.
/// Uses AtomicI32 to match the C++ `volatile LONG` fields.
#[repr(C)]
struct LockData {
    waiters: AtomicI32,
    busy: AtomicI32,
}

/// A lock backed by a Windows shared memory region and event, matching the C++
/// `SharedMemoryLock` implementation in `SharedMemoryInterface.hpp`.
///
/// Acquire with [`SharedMemoryLock::lock`] and release with [`SharedMemoryLock::unlock`].
pub struct SharedMemoryLock {
    map_handle: HANDLE,
    wait_event_handle: HANDLE,
    data_ptr: *mut LockData,
}

// SAFETY: The raw pointers are only used within the lock/unlock methods which
// are guarded by the Windows synchronization primitives.
unsafe impl Send for SharedMemoryLock {}
unsafe impl Sync for SharedMemoryLock {}

impl SharedMemoryLock {
    /// Open (or create) the shared lock. Returns `Err` if any Windows API call fails.
    pub fn new() -> Result<Self, String> {
        unsafe {
            let map_handle = CreateFileMappingA(
                INVALID_HANDLE_VALUE,
                ptr::null_mut(),
                PAGE_READWRITE,
                0,
                size_of::<LockData>() as u32,
                LMU_LOCK_DATA_NAME.as_ptr() as *const i8,
            );
            if map_handle.is_null() {
                return Err(format!(
                    "CreateFileMappingA(LMU_SharedMemoryLockData) failed: {}",
                    GetLastError()
                ));
            }

            // Check if we just created it (vs. opened existing)
            let just_created = GetLastError() != ERROR_ALREADY_EXISTS;

            let data_ptr =
                MapViewOfFile(map_handle, FILE_MAP_ALL_ACCESS, 0, 0, size_of::<LockData>())
                    as *mut LockData;

            if data_ptr.is_null() {
                CloseHandle(map_handle);
                return Err(format!(
                    "MapViewOfFile(LMU_SharedMemoryLockData) failed: {}",
                    GetLastError()
                ));
            }

            // Only reset if we just created the mapping (not if it already existed)
            if just_created {
                (*data_ptr).waiters.store(0, Ordering::SeqCst);
                (*data_ptr).busy.store(0, Ordering::SeqCst);
            }

            let wait_event_handle = CreateEventA(
                ptr::null_mut(),
                FALSE,
                FALSE,
                LMU_LOCK_EVENT_NAME.as_ptr() as *const i8,
            );
            if wait_event_handle.is_null() {
                UnmapViewOfFile(data_ptr as _);
                CloseHandle(map_handle);
                return Err(format!(
                    "CreateEventA(LMU_SharedMemoryLockEvent) failed: {}",
                    GetLastError()
                ));
            }

            Ok(SharedMemoryLock {
                map_handle,
                wait_event_handle,
                data_ptr,
            })
        }
    }

    /// Acquire the lock. Spins up to 4000 times, then falls back to waiting on the event.
    pub fn lock(&self) {
        const MAX_SPINS: i32 = 4000;
        unsafe {
            let busy = &(*self.data_ptr).busy;

            // Fast path: spin
            for _ in 0..MAX_SPINS {
                // Atomic compare-exchange: if busy == 0, set to 1 and return
                if busy
                    .compare_exchange(0, 1, Ordering::Acquire, Ordering::Relaxed)
                    .is_ok()
                {
                    return;
                }
                // CPU pause hint (equivalent to YieldProcessor())
                core::hint::spin_loop();
            }

            // Slow path: register as waiter and wait on event
            let waiters = &(*self.data_ptr).waiters;
            waiters.fetch_add(1, Ordering::SeqCst);
            loop {
                if busy
                    .compare_exchange(0, 1, Ordering::Acquire, Ordering::Relaxed)
                    .is_ok()
                {
                    waiters.fetch_sub(1, Ordering::SeqCst);
                    return;
                }
                WaitForSingleObject(self.wait_event_handle, INFINITE);
            }
        }
    }

    /// Release the lock and signal any waiters.
    pub fn unlock(&self) {
        unsafe {
            let busy = &(*self.data_ptr).busy;
            let waiters = &(*self.data_ptr).waiters;
            busy.store(0, Ordering::Release);
            if waiters.load(Ordering::SeqCst) > 0 {
                SetEvent(self.wait_event_handle);
            }
        }
    }
}

impl Drop for SharedMemoryLock {
    fn drop(&mut self) {
        unsafe {
            if !self.wait_event_handle.is_null() {
                CloseHandle(self.wait_event_handle);
            }
            if !self.data_ptr.is_null() {
                UnmapViewOfFile(self.data_ptr as _);
            }
            if !self.map_handle.is_null() {
                CloseHandle(self.map_handle);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// read_telemetry — one-shot shared memory read
// ─────────────────────────────────────────────────────────────────────────────

/// Read the current LMU telemetry from the `LMU_Data` shared memory file.
///
/// Opens the mapping, acquires the shared lock, copies the data with
/// `ptr::copy_nonoverlapping`, releases the lock, and closes the mapping.
///
/// Returns a heap-allocated [`SharedMemoryObjectOut`] to avoid stack overflow
/// (the struct is ~190 KB).
///
/// # Errors
///
/// Returns `Err` if the shared memory file is not available (i.e. LMU is not
/// running) or if any Windows API call fails.
#[allow(dead_code)]
pub fn read_telemetry() -> Result<Box<SharedMemoryObjectOut>, String> {
    // Convert the name to a wide (UTF-16) string for OpenFileMappingW
    let wide_name: Vec<u16> = LMU_SHARED_MEMORY_FILE
        .encode_utf16()
        .chain(std::iter::once(0u16))
        .collect();

    unsafe {
        // Open the file mapping (read-only is sufficient for consumers)
        let map_handle = OpenFileMappingW(FILE_MAP_READ, FALSE, wide_name.as_ptr());
        if map_handle.is_null() {
            return Err(format!(
                "OpenFileMappingW('{}') failed: {}. Is LMU running?",
                LMU_SHARED_MEMORY_FILE,
                GetLastError()
            ));
        }

        // Map a view of the entire SharedMemoryLayout
        let view_ptr = MapViewOfFile(
            map_handle,
            FILE_MAP_READ,
            0,
            0,
            size_of::<SharedMemoryLayout>(),
        ) as *const SharedMemoryLayout;

        if view_ptr.is_null() {
            CloseHandle(map_handle);
            return Err(format!(
                "MapViewOfFile('{}') failed: {}",
                LMU_SHARED_MEMORY_FILE,
                GetLastError()
            ));
        }

        // Acquire the shared lock to avoid reading torn data.
        // If we can't get the lock (e.g. LMU hasn't initialized it yet), we
        // still read — the data may be slightly inconsistent but won't crash.
        let lock_result = SharedMemoryLock::new();
        if let Ok(ref lock) = lock_result {
            lock.lock();
        }

        // Heap-allocate the destination to avoid ~190 KB stack usage
        let mut out = Box::<SharedMemoryObjectOut>::default();

        // Copy from the memory-mapped region into our owned buffer
        ptr::copy_nonoverlapping(
            &(*view_ptr).data as *const SharedMemoryObjectOut,
            out.as_mut() as *mut SharedMemoryObjectOut,
            1,
        );

        if let Ok(ref lock) = lock_result {
            lock.unlock();
        }

        // Clean up
        UnmapViewOfFile(view_ptr as _);
        CloseHandle(map_handle);

        Ok(out)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SharedMemoryReader — persistent reader for high-frequency polling
// ─────────────────────────────────────────────────────────────────────────────

/// A persistent shared memory reader that keeps the mapping open between reads.
///
/// More efficient than [`read_telemetry`] when reading multiple times per second,
/// because it avoids the overhead of `OpenFileMappingW`/`MapViewOfFile`/`CloseHandle`
/// on every call.
///
/// # Example
///
/// ```text
/// let reader = SharedMemoryReader::open().unwrap();
/// loop {
///     let data = reader.read().unwrap();
///     // process data...
///     std::thread::sleep(std::time::Duration::from_millis(16)); // ~60 Hz
/// }
/// ```
#[allow(dead_code)]
pub struct SharedMemoryReader {
    map_handle: HANDLE,
    view_ptr: *const SharedMemoryLayout,
    lock: Option<SharedMemoryLock>,
}

// SAFETY: The raw pointers are only used in `read()` which is guarded by the lock.
unsafe impl Send for SharedMemoryReader {}
unsafe impl Sync for SharedMemoryReader {}

#[allow(dead_code)]
impl SharedMemoryReader {
    /// Open the `LMU_Data` shared memory mapping. Returns `Err` if LMU is not running.
    pub fn open() -> Result<Self, String> {
        let wide_name: Vec<u16> = LMU_SHARED_MEMORY_FILE
            .encode_utf16()
            .chain(std::iter::once(0u16))
            .collect();

        unsafe {
            let map_handle = OpenFileMappingW(FILE_MAP_READ, FALSE, wide_name.as_ptr());
            if map_handle.is_null() {
                return Err(format!(
                    "OpenFileMappingW('{}') failed: {}. Is LMU running?",
                    LMU_SHARED_MEMORY_FILE,
                    GetLastError()
                ));
            }

            let view_ptr = MapViewOfFile(
                map_handle,
                FILE_MAP_READ,
                0,
                0,
                size_of::<SharedMemoryLayout>(),
            ) as *const SharedMemoryLayout;

            if view_ptr.is_null() {
                CloseHandle(map_handle);
                return Err(format!(
                    "MapViewOfFile('{}') failed: {}",
                    LMU_SHARED_MEMORY_FILE,
                    GetLastError()
                ));
            }

            let lock = SharedMemoryLock::new().ok();

            Ok(SharedMemoryReader {
                map_handle,
                view_ptr,
                lock,
            })
        }
    }

    /// Read the current telemetry data. Acquires the lock, copies the data, releases the lock.
    ///
    /// Returns a heap-allocated copy to avoid stack overflow.
    pub fn read(&self) -> Result<Box<SharedMemoryObjectOut>, String> {
        unsafe {
            if let Some(ref lock) = self.lock {
                lock.lock();
            }

            let mut out = Box::<SharedMemoryObjectOut>::default();

            ptr::copy_nonoverlapping(
                &(*self.view_ptr).data as *const SharedMemoryObjectOut,
                out.as_mut() as *mut SharedMemoryObjectOut,
                1,
            );

            if let Some(ref lock) = self.lock {
                lock.unlock();
            }

            Ok(out)
        }
    }
}

impl Drop for SharedMemoryReader {
    fn drop(&mut self) {
        unsafe {
            if !self.view_ptr.is_null() {
                UnmapViewOfFile(self.view_ptr as _);
            }
            if !self.map_handle.is_null() {
                CloseHandle(self.map_handle);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration test — run with:
//   cargo test read_shared_memory -- --nocapture
// Requires LMU to be running with the shared memory plugin active.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod integration_tests {
    use super::*;

    /// Helper: convert a null-terminated `[u8; N]` to a &str (lossy).
    fn cstr(bytes: &[u8]) -> &str {
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        std::str::from_utf8(&bytes[..end]).unwrap_or("<invalid utf8>")
    }

    /// Print detailed telemetry for the player's car.
    ///
    /// Run with:
    ///   cargo test player_car_telemetry -- --nocapture
    ///
    /// LMU must be running and the player must be in a session (on track).
    #[test]
    fn player_car_telemetry() {
        let data = match read_telemetry() {
            Ok(d) => d,
            Err(e) => {
                println!("WARNING: Could not read shared memory: {}", e);
                println!("         Make sure Le Mans Ultimate is running.");
                return;
            }
        };

        let active = data.telemetry.active_vehicles as usize;
        let player_idx = data.telemetry.player_vehicle_idx as usize;
        let has_vehicle = data.telemetry.player_has_vehicle != 0;

        println!("=== Player Car Telemetry ===");
        println!("  activeVehicles  : {}", active);
        println!("  playerVehicleIdx: {}", player_idx);
        println!("  playerHasVehicle: {}", has_vehicle);

        if !has_vehicle || active == 0 {
            println!("  (Player is not in a vehicle or telemetry not yet updated)");
            println!("  Hint: Drive onto the track to trigger SME_UPDATE_TELEMETRY.");
            println!();
            // Still try to print scoring data for the player
            println!("=== Player Scoring (from scoring data) ===");
            let num_v = (data.scoring.scoringInfo.mNumVehicles.max(0) as usize)
                .min(data.scoring.vehScoringInfo.len());
            for i in 0..num_v {
                let v = &data.scoring.vehScoringInfo[i];
                if v.mIsPlayer != 0 {
                    let v_id = v.mID;
                    let v_lap_dist = v.mLapDist;
                    let v_time_into_lap = v.mTimeIntoLap;
                    let v_best_lap = v.mBestLapTime;
                    let v_last_lap = v.mLastLapTime;
                    let v_pos_x = v.mPos.x;
                    let v_pos_y = v.mPos.y;
                    let v_pos_z = v.mPos.z;
                    let v_vel_x = v.mLocalVel.x;
                    let v_vel_y = v.mLocalVel.y;
                    let v_vel_z = v.mLocalVel.z;
                    let speed_ms =
                        (v_vel_x * v_vel_x + v_vel_y * v_vel_y + v_vel_z * v_vel_z).sqrt();
                    println!("  driver      : {}", cstr(&v.mDriverName));
                    println!("  vehicle     : {}", cstr(&v.mVehicleName));
                    println!("  slotID      : {}", v_id);
                    println!("  place       : {}", v.mPlace);
                    println!("  laps        : {}", v.mTotalLaps);
                    let track_total_s = data.scoring.scoringInfo.mLapDist;
                    println!(
                        "  lapDist     : {:.1} m  (track = {:.1} m)",
                        v_lap_dist, track_total_s
                    );
                    println!("  timeIntoLap : {:.3} s", v_time_into_lap);
                    println!("  bestLap     : {:.3} s", v_best_lap);
                    println!("  lastLap     : {:.3} s", v_last_lap);
                    println!(
                        "  pos (world) : ({:.2}, {:.2}, {:.2})",
                        v_pos_x, v_pos_y, v_pos_z
                    );
                    println!(
                        "  speed       : {:.1} km/h  ({:.2} m/s)",
                        speed_ms * 3.6,
                        speed_ms
                    );
                    break;
                }
            }
            return;
        }

        let t = &data.telemetry.telem_info[player_idx];

        // Copy all numeric fields to locals (required for packed structs)
        let t_id = t.mID;
        let t_lap = t.mLapNumber;
        let t_elapsed = t.mElapsedTime;
        let t_lap_start = t.mLapStartET;
        let t_pos_x = t.mPos.x;
        let t_pos_y = t.mPos.y;
        let t_pos_z = t.mPos.z;
        let t_vel_x = t.mLocalVel.x;
        let t_vel_y = t.mLocalVel.y;
        let t_vel_z = t.mLocalVel.z;
        let t_gear = t.mGear;
        let t_rpm = t.mEngineRPM;
        let t_max_rpm = t.mEngineMaxRPM;
        let t_water = t.mEngineWaterTemp;
        let t_oil = t.mEngineOilTemp;
        let t_fuel = t.mFuel;
        let t_fuel_cap = t.mFuelCapacity;
        let t_throttle = t.mFilteredThrottle;
        let t_brake = t.mFilteredBrake;
        let t_steering = t.mFilteredSteering;
        let t_clutch = t.mFilteredClutch;
        let t_turbo = t.mTurboBoostPressure;
        let t_battery = t.mBatteryChargeFraction;
        let t_overheating = t.mOverheating;
        let t_headlights = t.mHeadlights;
        let t_speed_limiter = t.mSpeedLimiter;
        let t_delta_best = t.mDeltaBest;
        let t_front_downforce = t.mFrontDownforce;
        let t_rear_downforce = t.mRearDownforce;
        let t_drag = t.mDrag;
        let t_front_ride = t.mFrontRideHeight;
        let t_rear_ride = t.mRearRideHeight;
        let t_rear_brake_bias = t.mRearBrakeBias;
        let t_engine_torque = t.mEngineTorque;
        let t_current_sector = t.mCurrentSector;
        let t_boost_motor_rpm = t.mElectricBoostMotorRPM;
        let t_boost_motor_torque = t.mElectricBoostMotorTorque;
        let t_boost_motor_temp = t.mElectricBoostMotorTemperature;
        let t_boost_state = t.mElectricBoostMotorState;

        // Speed = magnitude of local velocity vector
        let speed_ms = (t_vel_x * t_vel_x + t_vel_y * t_vel_y + t_vel_z * t_vel_z).sqrt();
        // Current lap time = elapsed time - lap start time
        let current_lap_time = t_elapsed - t_lap_start;

        // Find player scoring entry for track position
        let num_v = (data.scoring.scoringInfo.mNumVehicles.max(0) as usize)
            .min(data.scoring.vehScoringInfo.len());
        let mut track_pos_m = 0.0f64;
        let mut time_into_lap = 0.0f64;
        for i in 0..num_v {
            let v = &data.scoring.vehScoringInfo[i];
            if v.mID == t_id {
                track_pos_m = v.mLapDist;
                time_into_lap = v.mTimeIntoLap;
                break;
            }
        }
        let track_total = data.scoring.scoringInfo.mLapDist;

        println!("\n=== Player: {} ===", cstr(&t.mVehicleName));
        println!("  slotID      : {}", t_id);
        println!("  track       : {}", cstr(&t.mTrackName));

        println!("\n--- Position & Motion ---");
        println!(
            "  pos (world) : ({:.2}, {:.2}, {:.2}) m",
            t_pos_x, t_pos_y, t_pos_z
        );
        println!(
            "  vel (local) : ({:.2}, {:.2}, {:.2}) m/s",
            t_vel_x, t_vel_y, t_vel_z
        );
        println!(
            "  speed       : {:.1} km/h  ({:.2} m/s)",
            speed_ms * 3.6,
            speed_ms
        );
        println!(
            "  track pos   : {:.1} / {:.1} m  ({:.1}%)",
            track_pos_m,
            track_total,
            if track_total > 0.0 {
                track_pos_m / track_total * 100.0
            } else {
                0.0
            }
        );

        println!("\n--- Lap Timing ---");
        println!("  lap number  : {}", t_lap);
        println!("  current lap : {:.3} s  (from elapsed)", current_lap_time);
        println!("  time in lap : {:.3} s  (from scoring)", time_into_lap);
        println!("  delta best  : {:+.3} s", t_delta_best);
        println!("  elapsed     : {:.3} s", t_elapsed);

        println!("\n--- Powertrain ---");
        let gear_str = match t_gear {
            -1 => "R".to_string(),
            0 => "N".to_string(),
            g => g.to_string(),
        };
        println!("  gear        : {}", gear_str);
        println!("  RPM         : {:.0} / {:.0}", t_rpm, t_max_rpm);
        println!(
            "  RPM %       : {:.1}%",
            if t_max_rpm > 0.0 {
                t_rpm / t_max_rpm * 100.0
            } else {
                0.0
            }
        );
        println!("  torque      : {:.1} Nm", t_engine_torque);
        println!("  turboBoost  : {:.3} bar", t_turbo);
        println!(
            "  fuel        : {:.2} / {:.2} L  ({:.1}%)",
            t_fuel,
            t_fuel_cap,
            if t_fuel_cap > 0.0 {
                t_fuel / t_fuel_cap * 100.0
            } else {
                0.0
            }
        );

        println!("\n--- Driver Inputs ---");
        println!("  throttle    : {:.1}%", t_throttle * 100.0);
        println!("  brake       : {:.1}%", t_brake * 100.0);
        println!(
            "  steering    : {:.1}%  ({:.3} raw)",
            t_steering * 100.0,
            t_steering
        );
        println!("  clutch      : {:.1}%", t_clutch * 100.0);
        println!("  rearBrakeBias: {:.1}%", t_rear_brake_bias * 100.0);

        println!("\n--- Temperatures ---");
        println!("  water       : {:.1} C", t_water);
        println!("  oil         : {:.1} C", t_oil);

        println!("\n--- Aerodynamics ---");
        println!("  frontDownforce: {:.1} N", t_front_downforce);
        println!("  rearDownforce : {:.1} N", t_rear_downforce);
        println!("  drag          : {:.1} N", t_drag);
        println!("  frontRideH    : {:.4} m", t_front_ride);
        println!("  rearRideH     : {:.4} m", t_rear_ride);

        println!("\n--- Status ---");
        println!("  overheating : {}", t_overheating != 0);
        println!("  headlights  : {}", t_headlights != 0);
        println!("  speedLimiter: {}", t_speed_limiter != 0);
        println!("  sector      : {}", t_current_sector & 0x7FFFFFFF);
        println!(
            "  inPitLane   : {}",
            (t_current_sector & 0x80000000u32 as i32) != 0
        );
        println!("  frontTire   : {}", cstr(&t.mFrontTireCompoundName));
        println!("  rearTire    : {}", cstr(&t.mRearTireCompoundName));
        println!("  battery     : {:.1}%", t_battery * 100.0);

        if t_boost_state > 0 {
            let state_str = match t_boost_state {
                1 => "inactive",
                2 => "propulsion",
                3 => "regeneration",
                _ => "unknown",
            };
            println!("\n--- Electric Boost Motor ---");
            println!("  state       : {} ({})", t_boost_state, state_str);
            println!("  RPM         : {:.0}", t_boost_motor_rpm);
            println!("  torque      : {:.1} Nm", t_boost_motor_torque);
            println!("  temp        : {:.1} C", t_boost_motor_temp - 273.15);
        }

        println!("\n--- Wheels (FL / FR / RL / RR) ---");
        let wheel_names = ["FL", "FR", "RL", "RR"];
        for (wi, wname) in wheel_names.iter().enumerate() {
            let w = &t.mWheel[wi];
            let w_brake_temp = w.mBrakeTemp;
            let w_pressure = w.mPressure;
            let w_wear = w.mWear;
            let w_flat = w.mFlat;
            let w_rotation = w.mRotation;
            let w_susp = w.mSuspensionDeflection;
            let w_ride = w.mRideHeight;
            let w_camber = w.mCamber;
            let w_lat_force = w.mLateralForce;
            let w_lon_force = w.mLongitudinalForce;
            let w_tire_load = w.mTireLoad;
            let w_grip = w.mGripFract;
            let w_temp_l = w.mTemperature[0] - 273.15;
            let w_temp_c = w.mTemperature[1] - 273.15;
            let w_temp_r = w.mTemperature[2] - 273.15;
            let w_carcass_temp = w.mTireCarcassTemperature - 273.15;
            println!("  [{}]", wname);
            println!(
                "    rotation    : {:.2} rad/s  ({:.1} rpm)",
                w_rotation,
                w_rotation * 60.0 / (2.0 * std::f64::consts::PI)
            );
            println!("    brakeTemp   : {:.1} C", w_brake_temp);
            println!("    pressure    : {:.1} kPa", w_pressure);
            println!("    wear        : {:.3}  ({:.1}%)", w_wear, w_wear * 100.0);
            println!("    flat        : {}", w_flat != 0);
            println!(
                "    temp L/C/R  : {:.1} / {:.1} / {:.1} C",
                w_temp_l, w_temp_c, w_temp_r
            );
            println!("    carcassTemp : {:.1} C", w_carcass_temp);
            println!("    suspDefl    : {:.4} m", w_susp);
            println!("    rideHeight  : {:.4} m", w_ride);
            println!(
                "    camber      : {:.4} rad  ({:.2} deg)",
                w_camber,
                w_camber.to_degrees()
            );
            println!("    latForce    : {:.1} N", w_lat_force);
            println!("    lonForce    : {:.1} N", w_lon_force);
            println!("    tireLoad    : {:.1} N", w_tire_load);
            println!("    gripFract   : {:.3}", w_grip);
            println!("    terrain     : {}", cstr(&w.mTerrainName));
        }

        println!("\n=== Done ===");
    }

    /// Read the LMU shared memory and print all interesting values to stdout.
    ///
    /// Run with:
    ///   cargo test read_shared_memory -- --nocapture
    ///
    /// LMU must be running for this test to succeed.
    #[test]
    fn read_shared_memory() {
        let data = match read_telemetry() {
            Ok(d) => d,
            Err(e) => {
                println!("WARNING: Could not read shared memory: {}", e);
                println!("         Make sure Le Mans Ultimate is running.");
                // Don't fail the test if LMU isn't running — just skip.
                return;
            }
        };

        // ── Generic / session state ──────────────────────────────────────────
        println!("=== SharedMemoryGeneric ===");
        println!("  gameVersion : {}", data.generic.gameVersion);
        println!("  FFBTorque   : {:.4}", data.generic.FFBTorque);
        let event_names = [
            "ENTER",
            "EXIT",
            "STARTUP",
            "SHUTDOWN",
            "LOAD",
            "UNLOAD",
            "START_SESSION",
            "END_SESSION",
            "ENTER_REALTIME",
            "EXIT_REALTIME",
            "UPDATE_SCORING",
            "UPDATE_TELEMETRY",
            "INIT_APPLICATION",
            "UNINIT_APPLICATION",
            "SET_ENVIRONMENT",
            "FFB",
        ];
        println!("  Events (non-zero only):");
        for (i, name) in event_names.iter().enumerate() {
            if data.generic.events[i] != 0 {
                println!("    [{}] SME_{} = {}", i, name, data.generic.events[i]);
            }
        }

        // ── App state ────────────────────────────────────────────────────────
        println!("\n=== ApplicationStateV01 ===");
        println!(
            "  Resolution  : {}x{} @ {} Hz  windowed={}",
            data.generic.appInfo.mWidth,
            data.generic.appInfo.mHeight,
            data.generic.appInfo.mRefreshRate,
            data.generic.appInfo.mWindowed,
        );
        println!("  Options loc : {}", data.generic.appInfo.mOptionsLocation);
        println!(
            "  Options page: {}",
            cstr(&data.generic.appInfo.mOptionsPage)
        );

        // ── Paths ────────────────────────────────────────────────────────────
        println!("\n=== SharedMemoryPathData ===");
        println!("  userData        : {}", cstr(&data.paths.userData));
        println!("  customVariables : {}", cstr(&data.paths.customVariables));
        println!("  stewardResults  : {}", cstr(&data.paths.stewardResults));
        println!("  playerProfile   : {}", cstr(&data.paths.playerProfile));
        println!("  pluginsFolder   : {}", cstr(&data.paths.pluginsFolder));

        // ── Scoring ──────────────────────────────────────────────────────────
        // With packed(4) structs, numeric fields must be copied to locals before use
        // (Rust forbids references to potentially-unaligned packed fields).
        println!("\n=== ScoringInfoV01 ===");
        let s = &data.scoring.scoringInfo;
        let s_session = s.mSession;
        let s_current_et = s.mCurrentET;
        let s_end_et = s.mEndET;
        let s_max_laps = s.mMaxLaps;
        let s_lap_dist = s.mLapDist;
        let s_num_vehicles = s.mNumVehicles;
        let s_game_phase = s.mGamePhase;
        let s_yellow_flag = s.mYellowFlagState;
        let s_in_realtime = s.mInRealtime;
        let s_ambient = s.mAmbientTemp;
        let s_track_temp = s.mTrackTemp;
        let s_raining = s.mRaining;
        let s_wind_x = s.mWind.x;
        let s_wind_y = s.mWind.y;
        let s_wind_z = s.mWind.z;
        println!("  track           : {}", cstr(&s.mTrackName));
        println!("  session         : {}", s_session);
        println!("  currentET       : {:.3}", s_current_et);
        println!("  endET           : {:.3}", s_end_et);
        println!("  maxLaps         : {}", s_max_laps);
        println!("  lapDist         : {:.1} m", s_lap_dist);
        println!("  numVehicles     : {}", s_num_vehicles);
        println!("  gamePhase       : {}", s_game_phase);
        println!("  yellowFlagState : {}", s_yellow_flag);
        println!("  inRealtime      : {}", s_in_realtime != 0);
        println!("  playerName      : {}", cstr(&s.mPlayerName));
        println!("  plrFileName     : {}", cstr(&s.mPlrFileName));
        println!("  ambientTemp     : {:.1} C", s_ambient);
        println!("  trackTemp       : {:.1} C", s_track_temp);
        println!("  raining         : {:.3}", s_raining);
        println!(
            "  wind            : ({:.2}, {:.2}, {:.2})",
            s_wind_x, s_wind_y, s_wind_z
        );

        // ── Vehicle scoring ──────────────────────────────────────────────────
        let num_vehicles = (s_num_vehicles.max(0) as usize).min(data.scoring.vehScoringInfo.len());
        println!(
            "\n=== VehicleScoringInfoV01 ({} vehicles) ===",
            num_vehicles
        );
        for i in 0..num_vehicles {
            let v = &data.scoring.vehScoringInfo[i];
            let v_id = v.mID;
            let v_place = v.mPlace;
            let v_laps = v.mTotalLaps;
            let v_lap_dist = v.mLapDist;
            let v_best_lap = v.mBestLapTime;
            println!(
                "  [{}] id={} driver={} vehicle={} place={} laps={} lapDist={:.1} bestLap={:.3}",
                i,
                v_id,
                cstr(&v.mDriverName),
                cstr(&v.mVehicleName),
                v_place,
                v_laps,
                v_lap_dist,
                v_best_lap,
            );
        }

        // ── Telemetry ────────────────────────────────────────────────────────
        let active = data.telemetry.active_vehicles as usize;
        let player_idx = data.telemetry.player_vehicle_idx as usize;
        println!("\n=== SharedMemoryTelemtryData ===");
        println!("  activeVehicles  : {}", active);
        println!("  playerVehicleIdx: {}", player_idx);
        println!(
            "  playerHasVehicle: {}",
            data.telemetry.player_has_vehicle != 0
        );

        // Print telemetry for all active vehicles (cap at 10 to avoid flooding)
        let print_count = active.min(10);
        for i in 0..print_count {
            let t = &data.telemetry.telem_info[i];
            let is_player = i == player_idx;
            // Copy all numeric fields to locals (required for packed structs)
            let t_id = t.mID;
            let t_lap = t.mLapNumber;
            let t_elapsed = t.mElapsedTime;
            let t_delta = t.mDeltaTime;
            let t_pos_x = t.mPos.x;
            let t_pos_y = t.mPos.y;
            let t_pos_z = t.mPos.z;
            let t_gear = t.mGear;
            let t_rpm = t.mEngineRPM;
            let t_max_rpm = t.mEngineMaxRPM;
            let t_water = t.mEngineWaterTemp;
            let t_oil = t.mEngineOilTemp;
            let t_fuel = t.mFuel;
            let t_fuel_cap = t.mFuelCapacity;
            let t_throttle = t.mFilteredThrottle;
            let t_brake = t.mFilteredBrake;
            let t_steering = t.mFilteredSteering;
            let t_clutch = t.mFilteredClutch;
            let t_turbo = t.mTurboBoostPressure;
            let t_battery = t.mBatteryChargeFraction;
            let t_overheating = t.mOverheating;
            let t_headlights = t.mHeadlights;
            let t_speed_limiter = t.mSpeedLimiter;
            let t_delta_best = t.mDeltaBest;

            println!(
                "\n  --- TelemInfoV01 [{}]{} ---",
                i,
                if is_player { " (PLAYER)" } else { "" }
            );
            println!("    vehicle     : {}", cstr(&t.mVehicleName));
            println!("    track       : {}", cstr(&t.mTrackName));
            println!("    slotID      : {}", t_id);
            println!("    lap         : {}", t_lap);
            println!("    elapsedTime : {:.3} s", t_elapsed);
            println!("    deltaTime   : {:.6} s", t_delta);
            println!(
                "    pos         : ({:.2}, {:.2}, {:.2})",
                t_pos_x, t_pos_y, t_pos_z
            );
            println!("    gear        : {}", t_gear);
            println!("    engineRPM   : {:.0}", t_rpm);
            println!("    engineMaxRPM: {:.0}", t_max_rpm);
            println!("    waterTemp   : {:.1} C", t_water);
            println!("    oilTemp     : {:.1} C", t_oil);
            println!("    fuel        : {:.2} L", t_fuel);
            println!("    fuelCap     : {:.2} L", t_fuel_cap);
            println!("    throttle    : {:.3}", t_throttle);
            println!("    brake       : {:.3}", t_brake);
            println!("    steering    : {:.3}", t_steering);
            println!("    clutch      : {:.3}", t_clutch);
            println!("    turboBoost  : {:.3} bar", t_turbo);
            println!("    battery     : {:.1}%", t_battery * 100.0);
            println!("    overheating : {}", t_overheating != 0);
            println!("    headlights  : {}", t_headlights != 0);
            println!("    speedLimiter: {}", t_speed_limiter != 0);
            println!("    frontTire   : {}", cstr(&t.mFrontTireCompoundName));
            println!("    rearTire    : {}", cstr(&t.mRearTireCompoundName));
            println!("    deltaBest   : {:.3} s", t_delta_best);

            // Wheels: FL, FR, RL, RR
            let wheel_names = ["FL", "FR", "RL", "RR"];
            for (wi, wname) in wheel_names.iter().enumerate() {
                let w = &t.mWheel[wi];
                let w_brake_temp = w.mBrakeTemp;
                let w_pressure = w.mPressure;
                let w_wear = w.mWear;
                let w_flat = w.mFlat;
                println!(
                    "    wheel[{}] brakeTemp={:.1}C pressure={:.1}kPa wear={:.3} flat={} terrain={}",
                    wname, w_brake_temp, w_pressure, w_wear, w_flat != 0,
                    cstr(&w.mTerrainName),
                );
            }
        }

        if active > 10 {
            println!("  ... ({} more vehicles not shown)", active - 10);
        }

        println!("\n=== Read complete ===");
    }

    /// Diagnostic test: print struct offsets and scan raw bytes to find where
    /// telemetry data actually lives in the shared memory.
    ///
    /// Run with:
    ///   cargo test diagnose_offsets -- --nocapture
    #[test]
    fn diagnose_offsets() {
        use std::mem::{offset_of, size_of};

        println!("=== Struct Sizes ===");
        println!(
            "  SharedMemoryGeneric     = {} bytes",
            size_of::<SharedMemoryGeneric>()
        );
        println!(
            "  SharedMemoryPathData    = {} bytes",
            size_of::<SharedMemoryPathData>()
        );
        println!(
            "  ScoringInfoV01          = {} bytes",
            size_of::<ScoringInfoV01>()
        );
        println!(
            "  VehicleScoringInfoV01   = {} bytes",
            size_of::<VehicleScoringInfoV01>()
        );
        println!(
            "  SharedMemoryScoringData = {} bytes",
            size_of::<SharedMemoryScoringData>()
        );
        println!(
            "  TelemInfoV01            = {} bytes",
            size_of::<TelemInfoV01>()
        );
        println!(
            "  SharedMemoryTelemtryData= {} bytes",
            size_of::<SharedMemoryTelemtryData>()
        );
        println!(
            "  SharedMemoryObjectOut   = {} bytes",
            size_of::<SharedMemoryObjectOut>()
        );

        println!("\n=== Field Offsets in SharedMemoryObjectOut ===");
        println!("  .generic  @ offset 0");
        let off_paths = size_of::<SharedMemoryGeneric>();
        let off_scoring = off_paths + size_of::<SharedMemoryPathData>();
        let off_telemetry = off_scoring + size_of::<SharedMemoryScoringData>();
        println!("  .paths    @ offset {}", off_paths);
        println!("  .scoring  @ offset {}", off_scoring);
        println!("  .telemetry@ offset {}", off_telemetry);

        let data = match read_telemetry() {
            Ok(d) => d,
            Err(e) => {
                println!("WARNING: {}", e);
                return;
            }
        };

        // Print the first 32 bytes of the telemetry section as hex
        // to see what's actually there
        println!("\n=== Raw bytes at telemetry offset (first 32 bytes) ===");
        let raw_ptr = &data.telemetry as *const SharedMemoryTelemtryData as *const u8;
        let raw_bytes: Vec<u8> = unsafe { std::slice::from_raw_parts(raw_ptr, 32).to_vec() };
        print!("  hex: ");
        for b in &raw_bytes {
            print!("{:02x} ", b);
        }
        println!();
        println!("  dec: {:?}", &raw_bytes[..8]);

        // Scan the entire SharedMemoryObjectOut for the first non-zero byte
        // after the scoring section — this tells us where telemetry actually starts
        println!("\n=== Scanning for non-zero bytes after scoring section ===");
        let obj_ptr = &*data as *const SharedMemoryObjectOut as *const u8;
        let obj_size = size_of::<SharedMemoryObjectOut>();
        let scan_start = off_scoring + size_of::<ScoringInfoV01>() + 8; // skip scoringInfo + scoringStreamSize
        let mut found_nonzero = false;
        for offset in (scan_start..obj_size).step_by(4) {
            let val = unsafe { *(obj_ptr.add(offset) as *const u32) };
            if val != 0 && val < 200 {
                // Looks like it could be activeVehicles (small number)
                println!(
                    "  offset {:6}: u32={} u8=[{},{},{},{}]",
                    offset,
                    val,
                    unsafe { *obj_ptr.add(offset) },
                    unsafe { *obj_ptr.add(offset + 1) },
                    unsafe { *obj_ptr.add(offset + 2) },
                    unsafe { *obj_ptr.add(offset + 3) },
                );
                found_nonzero = true;
                if offset > off_telemetry + 100 {
                    break;
                }
            }
        }
        if !found_nonzero {
            println!("  No small non-zero values found in scan range");
        }
    }

    // (duplicate removed)
    #[allow(dead_code)]
    fn player_car_telemetry_duplicate_removed() {
        let data = match read_telemetry() {
            Ok(d) => d,
            Err(e) => {
                println!("WARNING: Could not read shared memory: {}", e);
                println!("         Make sure Le Mans Ultimate is running.");
                return;
            }
        };

        let active = data.telemetry.active_vehicles as usize;
        let player_idx = data.telemetry.player_vehicle_idx as usize;
        let has_vehicle = data.telemetry.player_has_vehicle != 0;

        println!("=== Player Car Telemetry ===");
        println!("  activeVehicles  : {}", active);
        println!("  playerVehicleIdx: {}", player_idx);
        println!("  playerHasVehicle: {}", has_vehicle);

        if !has_vehicle || active == 0 {
            println!("  (Player is not in a vehicle or telemetry not yet updated)");
            println!("  Hint: Drive onto the track to trigger SME_UPDATE_TELEMETRY.");
            println!();
            // Still try to print scoring data for the player
            println!("=== Player Scoring (from scoring data) ===");
            let num_v = (data.scoring.scoringInfo.mNumVehicles.max(0) as usize)
                .min(data.scoring.vehScoringInfo.len());
            for i in 0..num_v {
                let v = &data.scoring.vehScoringInfo[i];
                if v.mIsPlayer != 0 {
                    let v_id = v.mID;
                    let v_lap_dist = v.mLapDist;
                    let v_time_into_lap = v.mTimeIntoLap;
                    let v_best_lap = v.mBestLapTime;
                    let v_last_lap = v.mLastLapTime;
                    let v_pos_x = v.mPos.x;
                    let v_pos_y = v.mPos.y;
                    let v_pos_z = v.mPos.z;
                    let v_vel_x = v.mLocalVel.x;
                    let v_vel_y = v.mLocalVel.y;
                    let v_vel_z = v.mLocalVel.z;
                    let speed_ms =
                        (v_vel_x * v_vel_x + v_vel_y * v_vel_y + v_vel_z * v_vel_z).sqrt();
                    let track_total = data.scoring.scoringInfo.mLapDist;
                    println!("  driver      : {}", cstr(&v.mDriverName));
                    println!("  vehicle     : {}", cstr(&v.mVehicleName));
                    println!("  slotID      : {}", v_id);
                    println!("  place       : {}", v.mPlace);
                    println!("  laps        : {}", v.mTotalLaps);
                    println!(
                        "  lapDist     : {:.1} / {:.1} m  ({:.1}%)",
                        v_lap_dist,
                        track_total,
                        if track_total > 0.0 {
                            v_lap_dist / track_total * 100.0
                        } else {
                            0.0
                        }
                    );
                    println!("  timeIntoLap : {:.3} s", v_time_into_lap);
                    println!("  bestLap     : {:.3} s", v_best_lap);
                    println!("  lastLap     : {:.3} s", v_last_lap);
                    println!(
                        "  pos (world) : ({:.2}, {:.2}, {:.2})",
                        v_pos_x, v_pos_y, v_pos_z
                    );
                    println!(
                        "  speed       : {:.1} km/h  ({:.2} m/s)",
                        speed_ms * 3.6,
                        speed_ms
                    );
                    break;
                }
            }
            return;
        }

        let t = &data.telemetry.telem_info[player_idx];

        // Copy all numeric fields to locals (required for packed structs)
        let t_id = t.mID;
        let t_lap = t.mLapNumber;
        let t_elapsed = t.mElapsedTime;
        let t_lap_start = t.mLapStartET;
        let t_pos_x = t.mPos.x;
        let t_pos_y = t.mPos.y;
        let t_pos_z = t.mPos.z;
        let t_vel_x = t.mLocalVel.x;
        let t_vel_y = t.mLocalVel.y;
        let t_vel_z = t.mLocalVel.z;
        let t_gear = t.mGear;
        let t_rpm = t.mEngineRPM;
        let t_max_rpm = t.mEngineMaxRPM;
        let t_water = t.mEngineWaterTemp;
        let t_oil = t.mEngineOilTemp;
        let t_fuel = t.mFuel;
        let t_fuel_cap = t.mFuelCapacity;
        let t_throttle = t.mFilteredThrottle;
        let t_brake = t.mFilteredBrake;
        let t_steering = t.mFilteredSteering;
        let t_clutch = t.mFilteredClutch;
        let t_turbo = t.mTurboBoostPressure;
        let t_battery = t.mBatteryChargeFraction;
        let t_overheating = t.mOverheating;
        let t_headlights = t.mHeadlights;
        let t_speed_limiter = t.mSpeedLimiter;
        let t_delta_best = t.mDeltaBest;
        let t_front_downforce = t.mFrontDownforce;
        let t_rear_downforce = t.mRearDownforce;
        let t_drag = t.mDrag;
        let t_front_ride = t.mFrontRideHeight;
        let t_rear_ride = t.mRearRideHeight;
        let t_rear_brake_bias = t.mRearBrakeBias;
        let t_engine_torque = t.mEngineTorque;
        let t_current_sector = t.mCurrentSector;
        let t_boost_motor_rpm = t.mElectricBoostMotorRPM;
        let t_boost_motor_torque = t.mElectricBoostMotorTorque;
        let t_boost_motor_temp = t.mElectricBoostMotorTemperature;
        let t_boost_state = t.mElectricBoostMotorState;

        // Speed = magnitude of local velocity vector
        let speed_ms = (t_vel_x * t_vel_x + t_vel_y * t_vel_y + t_vel_z * t_vel_z).sqrt();
        // Current lap time = elapsed time - lap start time
        let current_lap_time = t_elapsed - t_lap_start;

        // Find player scoring entry for track position
        let num_v = (data.scoring.scoringInfo.mNumVehicles.max(0) as usize)
            .min(data.scoring.vehScoringInfo.len());
        let mut track_pos_m = 0.0f64;
        let mut time_into_lap = 0.0f64;
        for i in 0..num_v {
            let v = &data.scoring.vehScoringInfo[i];
            if v.mID == t_id {
                track_pos_m = v.mLapDist;
                time_into_lap = v.mTimeIntoLap;
                break;
            }
        }
        let track_total = data.scoring.scoringInfo.mLapDist;

        println!("\n=== Player: {} ===", cstr(&t.mVehicleName));
        println!("  slotID      : {}", t_id);
        println!("  track       : {}", cstr(&t.mTrackName));

        println!("\n--- Position & Motion ---");
        println!(
            "  pos (world) : ({:.2}, {:.2}, {:.2}) m",
            t_pos_x, t_pos_y, t_pos_z
        );
        println!(
            "  vel (local) : ({:.2}, {:.2}, {:.2}) m/s",
            t_vel_x, t_vel_y, t_vel_z
        );
        println!(
            "  speed       : {:.1} km/h  ({:.2} m/s)",
            speed_ms * 3.6,
            speed_ms
        );
        println!(
            "  track pos   : {:.1} / {:.1} m  ({:.1}%)",
            track_pos_m,
            track_total,
            if track_total > 0.0 {
                track_pos_m / track_total * 100.0
            } else {
                0.0
            }
        );

        println!("\n--- Lap Timing ---");
        println!("  lap number  : {}", t_lap);
        println!("  current lap : {:.3} s  (from elapsed)", current_lap_time);
        println!("  time in lap : {:.3} s  (from scoring)", time_into_lap);
        println!("  delta best  : {:+.3} s", t_delta_best);
        println!("  elapsed     : {:.3} s", t_elapsed);

        println!("\n--- Powertrain ---");
        let gear_str = match t_gear {
            -1 => "R".to_string(),
            0 => "N".to_string(),
            g => g.to_string(),
        };
        println!("  gear        : {}", gear_str);
        println!("  RPM         : {:.0} / {:.0}", t_rpm, t_max_rpm);
        println!(
            "  RPM %       : {:.1}%",
            if t_max_rpm > 0.0 {
                t_rpm / t_max_rpm * 100.0
            } else {
                0.0
            }
        );
        println!("  torque      : {:.1} Nm", t_engine_torque);
        println!("  turboBoost  : {:.3} bar", t_turbo);
        println!(
            "  fuel        : {:.2} / {:.2} L  ({:.1}%)",
            t_fuel,
            t_fuel_cap,
            if t_fuel_cap > 0.0 {
                t_fuel / t_fuel_cap * 100.0
            } else {
                0.0
            }
        );

        println!("\n--- Driver Inputs ---");
        println!("  throttle    : {:.1}%", t_throttle * 100.0);
        println!("  brake       : {:.1}%", t_brake * 100.0);
        println!(
            "  steering    : {:.1}%  ({:.3} raw)",
            t_steering * 100.0,
            t_steering
        );
        println!("  clutch      : {:.1}%", t_clutch * 100.0);
        println!("  rearBrakeBias: {:.1}%", t_rear_brake_bias * 100.0);

        println!("\n--- Temperatures ---");
        println!("  water       : {:.1} C", t_water);
        println!("  oil         : {:.1} C", t_oil);

        println!("\n--- Aerodynamics ---");
        println!("  frontDownforce: {:.1} N", t_front_downforce);
        println!("  rearDownforce : {:.1} N", t_rear_downforce);
        println!("  drag          : {:.1} N", t_drag);
        println!("  frontRideH    : {:.4} m", t_front_ride);
        println!("  rearRideH     : {:.4} m", t_rear_ride);

        println!("\n--- Status ---");
        println!("  overheating : {}", t_overheating != 0);
        println!("  headlights  : {}", t_headlights != 0);
        println!("  speedLimiter: {}", t_speed_limiter != 0);
        println!("  sector      : {}", t_current_sector & 0x7FFFFFFF);
        println!(
            "  inPitLane   : {}",
            (t_current_sector & (0x80000000u32 as i32)) != 0
        );
        println!("  frontTire   : {}", cstr(&t.mFrontTireCompoundName));
        println!("  rearTire    : {}", cstr(&t.mRearTireCompoundName));
        println!("  battery     : {:.1}%", t_battery * 100.0);

        if t_boost_state > 0 {
            let state_str = match t_boost_state {
                1 => "inactive",
                2 => "propulsion",
                3 => "regeneration",
                _ => "unknown",
            };
            println!("\n--- Electric Boost Motor ---");
            println!("  state       : {} ({})", t_boost_state, state_str);
            println!("  RPM         : {:.0}", t_boost_motor_rpm);
            println!("  torque      : {:.1} Nm", t_boost_motor_torque);
            println!("  temp        : {:.1} C", t_boost_motor_temp - 273.15);
        }

        println!("\n--- Wheels (FL / FR / RL / RR) ---");
        let wheel_names = ["FL", "FR", "RL", "RR"];
        for (wi, wname) in wheel_names.iter().enumerate() {
            let w = &t.mWheel[wi];
            let w_brake_temp = w.mBrakeTemp;
            let w_pressure = w.mPressure;
            let w_wear = w.mWear;
            let w_flat = w.mFlat;
            let w_rotation = w.mRotation;
            let w_susp = w.mSuspensionDeflection;
            let w_ride = w.mRideHeight;
            let w_camber = w.mCamber;
            let w_lat_force = w.mLateralForce;
            let w_lon_force = w.mLongitudinalForce;
            let w_tire_load = w.mTireLoad;
            let w_grip = w.mGripFract;
            let w_temp_l = w.mTemperature[0] - 273.15;
            let w_temp_c = w.mTemperature[1] - 273.15;
            let w_temp_r = w.mTemperature[2] - 273.15;
            let w_carcass_temp = w.mTireCarcassTemperature - 273.15;
            println!("  [{}]", wname);
            println!(
                "    rotation    : {:.2} rad/s  ({:.1} rpm)",
                w_rotation,
                w_rotation * 60.0 / (2.0 * std::f64::consts::PI)
            );
            println!("    brakeTemp   : {:.1} C", w_brake_temp);
            println!("    pressure    : {:.1} kPa", w_pressure);
            println!("    wear        : {:.3}  ({:.1}%)", w_wear, w_wear * 100.0);
            println!("    flat        : {}", w_flat != 0);
            println!(
                "    temp L/C/R  : {:.1} / {:.1} / {:.1} C",
                w_temp_l, w_temp_c, w_temp_r
            );
            println!("    carcassTemp : {:.1} C", w_carcass_temp);
            println!("    suspDefl    : {:.4} m", w_susp);
            println!("    rideHeight  : {:.4} m", w_ride);
            println!(
                "    camber      : {:.4} rad  ({:.2} deg)",
                w_camber,
                w_camber.to_degrees()
            );
            println!("    latForce    : {:.1} N", w_lat_force);
            println!("    lonForce    : {:.1} N", w_lon_force);
            println!("    tireLoad    : {:.1} N", w_tire_load);
            println!("    gripFract   : {:.3}", w_grip);
            println!("    terrain     : {}", cstr(&w.mTerrainName));
        }

        println!("\n=== Done ===");
    }
}
