import math
from typing import Any


DEFAULT_FACE_MATCH_THRESHOLD = 0.55


def validate_face_descriptor(descriptor: Any) -> list[float]:
    """
    Validate that a face descriptor is a 128-element finite float vector.
    """
    if not isinstance(descriptor, (list, tuple)) or len(descriptor) != 128:
        raise ValueError("Face descriptor must be a 128-dimensional vector")

    normalized: list[float] = []
    for val in descriptor:
        num = float(val)
        if not math.isfinite(num):
            raise ValueError("Face descriptor contains non-finite values")
        normalized.append(num)

    return normalized


def euclidean_face_distance(
    descriptor_a: list[float],
    descriptor_b: list[float]
) -> float:
    """
    Compute Euclidean distance between two 128-D face descriptors.
    Lower values indicate a closer match.
    """
    sq_sum = sum((a - b) ** 2 for a, b in zip(descriptor_a, descriptor_b))
    return round(math.sqrt(sq_sum), 4)


def verify_face_descriptor(
    stored_descriptor: Any,
    live_descriptor: Any,
    threshold: float = DEFAULT_FACE_MATCH_THRESHOLD
) -> dict[str, Any]:
    """
    Compare a live captured face descriptor against the user's registered descriptor.
    """
    stored_vec = validate_face_descriptor(stored_descriptor)
    live_vec = validate_face_descriptor(live_descriptor)

    distance = euclidean_face_distance(stored_vec, live_vec)
    matched = distance <= threshold

    return {
        "matched": matched,
        "distance": distance,
        "threshold": threshold
    }
