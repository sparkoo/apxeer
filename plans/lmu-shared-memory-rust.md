# LMU Shared Memory Reader — Rust Implementation Plan

## Overview

Implement reading the LMU (Le Mans Ultimate) shared memory interface in Rust, matching the C++ struct layout byte-for-byte, and expose a `read_telemetry()` function usable from the existing Tauri app.

## File Structure

```
apxeer-desktop/src-tauri/src/
├── lib.rs                        (fix duplicate invoke_handler bug)
├── telemetry.rs                  (placeholder module — already referenced)
└── lmu_telemetry/
    ├── mod.rs                    (read_telemetry() + SharedMemoryLock)
    └── types.rs                  (all C++ struct translations)
```

## C++ → Rust Type Mapping

All structs in `InternalsPlugin.hpp` use `#pragma pack(push, 4)` → Rust: `#[repr(C, packed(4))]`

| C++ type                 | Rust type                    | Notes                                               |
| ------------------------ | ---------------------------- | --------------------------------------------------- |
| `long`                   | `i32`                        | Windows `long` is always 32-bit                     |
| `unsigned long`          | `u32`                        |                                                     |
| `unsigned long long`     | `u64`                        |                                                     |
| `double`                 | `f64`                        |                                                     |
| `float`                  | `f32`                        |                                                     |
| `bool`                   | `u8`                         | C++ bool is 1 byte; Rust bool has stricter validity |
| `char[N]`                | `[u8; N]`                    | raw bytes                                           |
| `unsigned char`          | `u8`                         |                                                     |
| `signed char`            | `i8`                         |                                                     |
| `short`                  | `i16`                        |                                                     |
| `unsigned short`         | `u16`                        |                                                     |
| `HWND`                   | `*mut std::ffi::c_void`      | 8 bytes on 64-bit Windows                           |
| `size_t`                 | `usize`                      | 8 bytes on 64-bit Windows                           |
| `char*`                  | `*mut u8`                    | raw pointer (8 bytes)                               |
| `VehicleScoringInfoV01*` | `*mut VehicleScoringInfoV01` | raw pointer (8 bytes)                               |
| `uint8_t`                | `u8`                         |                                                     |
| `uint32_t`               | `u32`                        |                                                     |

## Structs to Translate (in dependency order)

### `types.rs`

1. **`TelemVect3`** — 3× f64 union/struct (24 bytes)
2. **`TelemQuat`** — 4× f64 (32 bytes)
3. **`TelemWheelV01`** — wheel telemetry (~232 bytes)
4. **`TelemInfoV01`** — full vehicle telemetry (~1408 bytes)
5. **`VehicleScoringInfoV01`** — scoring per vehicle (~392 bytes)
6. **`ScoringInfoV01`** — session scoring info (~784 bytes) — contains `*mut u8` and `*mut VehicleScoringInfoV01` pointer fields
7. **`ApplicationStateV01`** — app state (~256 bytes) — contains `HWND`
8. **`SharedMemoryEvent`** — enum as `u32` constants
9. **`SharedMemoryGeneric`** — generic data (~332 bytes)
10. **`SharedMemoryPathData`** — 5× `[u8; 260]` (1300 bytes)
11. **`SharedMemoryScoringData`** — scoring + 104 vehicles + stream buffer
12. **`SharedMemoryTelemtryData`** — 104× `TelemInfoV01`
13. **`SharedMemoryObjectOut`** — top-level container
14. **`SharedMemoryLayout`** — wraps `SharedMemoryObjectOut`

### `mod.rs`

- **`LockData`** struct — `{ waiters: i32, busy: i32 }` with `#[repr(C)]`
- **`SharedMemoryLock`** — wraps the `LMU_SharedMemoryLockData` mapping + `LMU_SharedMemoryLockEvent` event
  - `fn new() -> Result<Self, String>` — opens/creates the lock mapping
  - `fn lock(&self)` — spinlock with fallback to event wait
  - `fn unlock(&self)` — releases lock, signals event if waiters
- **`pub fn read_telemetry() -> Result<Box<SharedMemoryObjectOut>, String>`**
  1. Open `LMU_Data` file mapping with `OpenFileMappingW`
  2. `MapViewOfFile` for `size_of::<SharedMemoryLayout>()` bytes
  3. Acquire `SharedMemoryLock`
  4. `ptr::read_volatile` to copy `SharedMemoryObjectOut` into a `Box`
  5. Release lock
  6. `UnmapViewOfFile` + `CloseHandle`
  7. Return the boxed copy

## Memory Safety Notes

- All struct reads from shared memory are `unsafe` — wrapped in a dedicated function
- `ptr::read_volatile` prevents compiler from optimizing away reads from memory-mapped regions
- `Box<SharedMemoryObjectOut>` used to avoid stack overflow (struct is ~190KB+)
- `bool` fields stored as `u8` to avoid undefined behavior from invalid bool byte values
- Pointer fields (`*mut u8`, `*mut VehicleScoringInfoV01`) in `ScoringInfoV01` are never dereferenced from Rust — they are only present to maintain correct struct layout

## Struct Size Verification

Add `#[cfg(test)]` assertions using `std::mem::size_of` to verify sizes match C++ expectations:

```rust
#[cfg(test)]
mod tests {
    use super::types::*;
    use std::mem::size_of;

    #[test]
    fn check_struct_sizes() {
        assert_eq!(size_of::<TelemVect3>(), 24);
        assert_eq!(size_of::<TelemWheelV01>(), 232);
        // etc.
    }
}
```

## Changes to Existing Files

### `lib.rs`

- Fix duplicate `.invoke_handler()` calls (Tauri v2 only uses the last one — merge into a single call with both `greet` and `read_telemetry`)
- Keep `mod lmu_telemetry` and `mod telemetry` declarations

### `telemetry.rs`

- Create as empty module (just `// placeholder`)

## Dependencies (already in Cargo.toml)

- `winapi = { version = "0.3", features = ["everything"] }` — already present, provides `OpenFileMappingW`, `MapViewOfFile`, etc.

## Data Flow

```
LMU game process
    └── writes to "LMU_Data" shared memory
            ↓
Rust read_telemetry()
    ├── OpenFileMappingW("LMU_Data")
    ├── MapViewOfFile → *const SharedMemoryLayout
    ├── SharedMemoryLock::lock()
    ├── ptr::read_volatile → Box<SharedMemoryObjectOut>
    ├── SharedMemoryLock::unlock()
    └── UnmapViewOfFile + CloseHandle
            ↓
    Box<SharedMemoryObjectOut>
    ├── .generic.events[SME_UPDATE_TELEMETRY]
    ├── .telemetry.active_vehicles
    ├── .telemetry.player_has_vehicle
    ├── .telemetry.telem_info[0..active_vehicles]
    └── .scoring.scoring_info
```
