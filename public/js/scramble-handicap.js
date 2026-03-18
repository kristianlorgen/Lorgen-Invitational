(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ScrambleHandicap = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeSlopeRating(slopeRating) {
    const parsed = Number(slopeRating);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 113;
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function calculateCourseHandicapFromIndex(handicapIndex, slopeRating = 113) {
    const slope = normalizeSlopeRating(slopeRating);
    return Math.round((toNumber(handicapIndex) * slope) / 113);
  }

  function calculateTwoManScrambleHandicap(player1HandicapIndex, player2HandicapIndex, slopeRating = 113) {
    const player1CourseHcp = calculateCourseHandicapFromIndex(player1HandicapIndex, slopeRating);
    const player2CourseHcp = calculateCourseHandicapFromIndex(player2HandicapIndex, slopeRating);

    const low = Math.min(player1CourseHcp, player2CourseHcp);
    const high = Math.max(player1CourseHcp, player2CourseHcp);

    return Math.round(low * 0.35 + high * 0.15);
  }

  return {
    calculateCourseHandicapFromIndex,
    calculateTwoManScrambleHandicap
  };
});
