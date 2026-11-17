import math
from typing import Any


DEFAULT_FACE_MATCH_THRESHOLD = 0.55


def _validate_single_vector(vec: Any) -> list[float]:
    if not isinstance(vec, (list, tuple)) or len(vec) != 128:
        raise ValueError("Face descriptor must be a 128-dimensional vector")

    normalized: list[float] = []
    for val in vec:
        num = float(val)
        if not math.isfinite(num):
            raise ValueError("Face descriptor contains non-finite values")
        normalized.append(num)
    return normalized


def validate_face_descriptor(descriptor: Any) -> list[float] | list[list[float]]:
    """
    Validate either a single 128-D face descriptor OR a list of 128-D multi-pose descriptors.
    """
    if isinstance(descriptor, (list, tuple)) and len(descriptor) > 0:
        if isinstance(descriptor[0], (list, tuple)):
            if len(descriptor) > 10:
                raise ValueError("Too many facial pose samples (max 10)")
            return [_validate_single_vector(v) for v in descriptor]
        return _validate_single_vector(descriptor)

    raise ValueError("Face descriptor must be a 128-dimensional vector or list of vectors")


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
    Compare a live captured face descriptor against the user's registered descriptor(s).
    Supports both single-vector and multi-pose descriptor lists.
    """
    validated_stored = validate_face_descriptor(stored_descriptor)
    live_vec = _validate_single_vector(live_descriptor)

    if isinstance(validated_stored[0], list):
        pose_vectors: list[list[float]] = validated_stored  # type: ignore[assignment]
    else:
        pose_vectors = [validated_stored]  # type: ignore[list-item]

    distances = [euclidean_face_distance(pose, live_vec) for pose in pose_vectors]
    best_distance = min(distances)
    matched = best_distance <= threshold

    return {
        "matched": matched,
        "distance": best_distance,
        "threshold": threshold,
        "poses_checked": len(pose_vectors)
    }
