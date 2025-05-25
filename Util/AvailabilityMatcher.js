// Enhanced Availability Matching System
// This provides more sophisticated matching between shift requirements and employee availability

export class AvailabilityMatcher {
  constructor() {
    this.daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  }

  timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  // Calculate time overlap between two periods
  calculateOverlap(start1, end1, start2, end2) {
    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    return Math.max(0, overlapEnd - overlapStart);
  }

  // Normalize overnight shifts to handle day transitions
  normalizeTimeRange(startTime, endTime, startDay, endDay) {
    const daysOfWeekIndices = this.daysOfWeek.reduce((acc, day, idx) => {
      acc[day] = idx;
      return acc;
    }, {});

    const startDayIdx = daysOfWeekIndices[startDay.toLowerCase()];
    const endDayIdx = daysOfWeekIndices[endDay.toLowerCase()];
    const startMinutes = this.timeToMinutes(startTime);
    let endMinutes = this.timeToMinutes(endTime);

    // Handle multi-day shifts
    if (endDayIdx !== startDayIdx) {
      const dayDiff = endDayIdx > startDayIdx ? endDayIdx - startDayIdx : (7 - startDayIdx) + endDayIdx;
      endMinutes += dayDiff * 24 * 60;
    } else if (endMinutes <= startMinutes) {
      // Same day but end time is earlier (overnight shift)
      endMinutes += 24 * 60;
    }

    return {
      startMinutes,
      endMinutes,
      durationMinutes: endMinutes - startMinutes,
      durationHours: (endMinutes - startMinutes) / 60
    };
  }

  // Fixed availability matching logic
  // Replace the findBestEmployeesForShift method in AvailabilityMatcher class
  findBestEmployeesForShift(shiftRequirement, availabilities, employeeConstraints = {}) {
    const candidates = [];
    const day = shiftRequirement.day;

    // Normalize shift requirement time
    const shiftNorm = this.normalizeTimeRange(
      shiftRequirement.startTime,
      shiftRequirement.endTime,
      shiftRequirement.startDay || day,
      shiftRequirement.endDay || day
    );

    console.log(`Finding employees for shift: ${day} ${shiftRequirement.startTime}-${shiftRequirement.endTime} (${shiftNorm.durationHours.toFixed(2)}h)`);

    for (const availability of availabilities) {
      const employeeId = availability.employeeId._id.toString();
      
      // Check constraints (e.g., already assigned, hour limits)
      const constraints = employeeConstraints[employeeId] || {};
      if (constraints.alreadyAssignedToday) continue;
      if (constraints.maxHours && constraints.currentHours >= constraints.maxHours) continue;

      const dayAvailability = availability.days[day];
      if (!dayAvailability || !dayAvailability.available) continue;

      console.log(`Checking employee: ${availability.employeeId.name} for ${day}`);

      // Check each availability slot
      for (const availSlot of dayAvailability.slots) {
        console.log(`  Checking slot: ${availSlot.startTime}-${availSlot.endTime}`);
        
        // Normalize availability time
        const availNorm = this.normalizeTimeRange(
          availSlot.startTime,
          availSlot.endTime,
          availSlot.startDay || day,
          availSlot.endDay || day
        );

        // Check shift type compatibility
        const shiftTypeCompatible = this.isShiftTypeCompatible(
          shiftRequirement.shiftType,
          availSlot.shiftType,
          shiftRequirement.startTime
        );

        if (!shiftTypeCompatible) {
          console.log(`    Shift type incompatible: req=${shiftRequirement.shiftType}, avail=${availSlot.shiftType}`);
          continue;
        }

        // Calculate overlap with improved logic
        const overlapMinutes = this.calculateOverlap(
          shiftNorm.startMinutes,
          shiftNorm.endMinutes,
          availNorm.startMinutes,
          availNorm.endMinutes
        );

        if (overlapMinutes > 0) {
          const overlapHours = overlapMinutes / 60;
          const coveragePercentage = (overlapMinutes / shiftNorm.durationMinutes) * 100;

          // Calculate actual work time within the overlap
          const actualStartMinutes = Math.max(shiftNorm.startMinutes, availNorm.startMinutes);
          const actualEndMinutes = Math.min(shiftNorm.endMinutes, availNorm.endMinutes);

          console.log(`    Overlap found: ${overlapMinutes} minutes (${coveragePercentage.toFixed(1)}% coverage)`);
          console.log(`    Actual assignment: ${this.minutesToTime(actualStartMinutes)}-${this.minutesToTime(actualEndMinutes % (24 * 60))}`);

          candidates.push({
            employeeId,
            employee: availability.employeeId,
            coveragePercentage,
            overlapHours,
            overlapMinutes,
            actualStartMinutes,
            actualEndMinutes,
            actualStartTime: this.minutesToTime(actualStartMinutes),
            actualEndTime: this.minutesToTime(actualEndMinutes % (24 * 60)),
            preference: availSlot.preference || 0,
            currentHours: constraints.currentHours || 0,
            availabilitySlot: availSlot,
            shiftRequirement: shiftRequirement,
            // Add exact match bonus for perfect coverage
            exactMatch: coveragePercentage >= 99
          });
        } else {
          console.log(`    No overlap: shift ${shiftNorm.startMinutes}-${shiftNorm.endMinutes}, avail ${availNorm.startMinutes}-${availNorm.endMinutes}`);
        }
      }
    }

    // Enhanced ranking with exact match priority
    return this.rankCandidatesImproved(candidates, shiftRequirement);
  }

  // Improved ranking that prioritizes exact matches
  rankCandidatesImproved(candidates, shiftRequirement) {
    return candidates.sort((a, b) => {
      // Priority 1: Exact matches first (100% or near 100% coverage)
      if (a.exactMatch && !b.exactMatch) return -1;
      if (!a.exactMatch && b.exactMatch) return 1;
      
      // Priority 2: Higher coverage percentage
      const coverageDiff = b.coveragePercentage - a.coveragePercentage;
      if (Math.abs(coverageDiff) > 5) return coverageDiff;

      // Priority 3: Work-life balance (fewer current hours is better)
      const hoursDiff = a.currentHours - b.currentHours;
      if (Math.abs(hoursDiff) > 2) return hoursDiff;

      // Priority 4: Employee preference (higher is better)
      const prefDiff = b.preference - a.preference;
      if (Math.abs(prefDiff) > 1) return prefDiff;

      // Priority 5: Total overlap hours (more is better for efficiency)
      return b.overlapHours - a.overlapHours;
    });
  }

  // Determine if shift types are compatible
  isShiftTypeCompatible(reqShiftType, availShiftType, startTime) {
    // If either is not specified, assume compatible
    if (!reqShiftType || !availShiftType) return true;

    // Direct match
    if (reqShiftType.toLowerCase() === availShiftType.toLowerCase()) return true;

    // Infer shift type from time if not explicitly specified
    const startHour = parseInt(startTime.split(':')[0]);
    const inferredType = (startHour >= 18 || startHour < 6) ? 'night' : 'day';

    return (
      reqShiftType.toLowerCase() === inferredType ||
      availShiftType.toLowerCase() === inferredType
    );
  }

  // Rank candidates based on multiple criteria (original method, kept for compatibility)
  rankCandidates(candidates, shiftRequirement) {
    return candidates.sort((a, b) => {
      // Priority 1: Coverage percentage (higher is better)
      const coverageDiff = b.coveragePercentage - a.coveragePercentage;
      if (Math.abs(coverageDiff) > 10) return coverageDiff;

      // Priority 2: Work-life balance (fewer current hours is better)
      const hoursDiff = a.currentHours - b.currentHours;
      if (Math.abs(hoursDiff) > 4) return hoursDiff;

      // Priority 3: Employee preference (higher is better)
      const prefDiff = b.preference - a.preference;
      if (Math.abs(prefDiff) > 1) return prefDiff;

      // Priority 4: Total overlap hours (more is better for efficiency)
      return b.overlapHours - a.overlapHours;
    });
  }

  // Enhanced split shift requirement with better logic
  splitShiftRequirement(shiftRequirement, candidates, maxEmployeesPerShift = 3) {
    const assignments = [];
    const shiftNorm = this.normalizeTimeRange(
      shiftRequirement.startTime,
      shiftRequirement.endTime,
      shiftRequirement.startDay || shiftRequirement.day,
      shiftRequirement.endDay || shiftRequirement.day
    );

    console.log(`Splitting shift requirement: ${shiftRequirement.startTime}-${shiftRequirement.endTime}`);
    console.log(`Available candidates: ${candidates.length}`);

    // Strategy 1: Prioritize exact or near-exact matches
    const exactMatches = candidates.filter(c => c.coveragePercentage >= 95);
    
    if (exactMatches.length > 0) {
      console.log(`Found ${exactMatches.length} exact matches`);
      
      // Use the best exact matches up to the required number
      const neededEmployees = Math.min(shiftRequirement.minEmployees, exactMatches.length);
      for (let i = 0; i < neededEmployees; i++) {
        assignments.push(exactMatches[i]);
        console.log(`Assigned exact match: ${exactMatches[i].employee.name} (${exactMatches[i].coveragePercentage.toFixed(1)}%)`);
      }
      
      return assignments;
    }

    // Strategy 2: Use complementary partial coverage
    console.log(`No exact matches, using partial coverage strategy`);
    
    const usedEmployees = new Set();
    const coverageMap = new Array(shiftNorm.durationMinutes).fill(0);
    
    // Sort candidates by coverage percentage and fairness
    const sortedCandidates = [...candidates].sort((a, b) => {
      const coverageDiff = b.coveragePercentage - a.coveragePercentage;
      if (Math.abs(coverageDiff) > 10) return coverageDiff;
      
      const hoursDiff = a.currentHours - b.currentHours;
      return hoursDiff;
    });

    while (assignments.length < shiftRequirement.minEmployees && assignments.length < maxEmployeesPerShift) {
      let bestCandidate = null;
      let bestScore = 0;

      for (const candidate of sortedCandidates) {
        if (usedEmployees.has(candidate.employeeId)) continue;

        // Calculate how much uncovered time this employee would add
        const startOffset = Math.max(0, candidate.actualStartMinutes - shiftNorm.startMinutes);
        const endOffset = Math.min(shiftNorm.durationMinutes, candidate.actualEndMinutes - shiftNorm.startMinutes);
        
        let uncoveredMinutes = 0;
        for (let i = startOffset; i < endOffset; i++) {
          if (coverageMap[i] === 0) uncoveredMinutes++;
        }

        // Calculate score: prioritize uncovered time and high coverage
        const score = uncoveredMinutes * 2 + candidate.coveragePercentage;
        
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate || bestScore === 0) {
        console.log(`No more suitable candidates found`);
        break;
      }

      // Add the best candidate
      assignments.push(bestCandidate);
      usedEmployees.add(bestCandidate.employeeId);

      // Update coverage map
      const startOffset = Math.max(0, bestCandidate.actualStartMinutes - shiftNorm.startMinutes);
      const endOffset = Math.min(shiftNorm.durationMinutes, bestCandidate.actualEndMinutes - shiftNorm.startMinutes);
      
      for (let i = startOffset; i < endOffset; i++) {
        coverageMap[i]++;
      }

      console.log(`Assigned partial coverage: ${bestCandidate.employee.name} (${bestCandidate.coveragePercentage.toFixed(1)}%)`);
    }

    return assignments;
  }

  // Calculate shift coverage statistics
  calculateShiftCoverage(assignments, shiftRequirement) {
    const shiftNorm = this.normalizeTimeRange(
      shiftRequirement.startTime,
      shiftRequirement.endTime,
      shiftRequirement.startDay || shiftRequirement.day,
      shiftRequirement.endDay || shiftRequirement.day
    );

    const coverageMap = new Array(shiftNorm.durationMinutes).fill(0);
    
    for (const assignment of assignments) {
      const startOffset = Math.max(0, assignment.actualStartMinutes - shiftNorm.startMinutes);
      const endOffset = Math.min(shiftNorm.durationMinutes, assignment.actualEndMinutes - shiftNorm.startMinutes);
      
      for (let i = startOffset; i < endOffset; i++) {
        coverageMap[i]++;
      }
    }

    const coveredMinutes = coverageMap.filter(coverage => coverage > 0).length;
    const overCoveredMinutes = coverageMap.filter(coverage => coverage > 1).length;
    const coveragePercentage = (coveredMinutes / shiftNorm.durationMinutes) * 100;

    return {
      totalDurationMinutes: shiftNorm.durationMinutes,
      coveredMinutes,
      uncoveredMinutes: shiftNorm.durationMinutes - coveredMinutes,
      overCoveredMinutes,
      coveragePercentage,
      employeeCount: assignments.length,
      requiredEmployees: shiftRequirement.minEmployees,
      meetsRequirement: assignments.length >= shiftRequirement.minEmployees && coveragePercentage >= 80
    };
  }
}

// Usage example for the enhanced auto-scheduler
export const enhancedAutoSchedule = async (companyId, departmentId, startDate, endDate, shiftRequirements, availabilities) => {
  const matcher = new AvailabilityMatcher();
  const shifts = [];
  const employeeConstraints = {};
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  // Initialize employee constraints
  for (const avail of availabilities) {
    const employeeId = avail.employeeId._id.toString();
    employeeConstraints[employeeId] = {
      currentHours: 0,
      assignedDays: new Set(),
      maxHours: 40, // Weekly limit
      alreadyAssignedToday: false
    };
  }

  // Process each day
  for (let dayIndex = 0; dayIndex < daysOfWeek.length; dayIndex++) {
    const day = daysOfWeek[dayIndex];
    
    // Reset daily assignments
    Object.keys(employeeConstraints).forEach(empId => {
      employeeConstraints[empId].alreadyAssignedToday = false;
    });

    // Get all shift requirements for this day
    const dayRequirements = [];
    for (const requirement of shiftRequirements) {
      const daySlots = requirement[day] || [];
      daySlots.forEach(slot => {
        dayRequirements.push({
          ...slot,
          departmentId: requirement.departmentId,
          day: day
        });
      });
    }

    // Sort by start time
    dayRequirements.sort((a, b) => 
      matcher.timeToMinutes(a.startTime) - matcher.timeToMinutes(b.startTime)
    );

    // Process each shift requirement
    for (const shiftReq of dayRequirements) {
      console.log(`\nProcessing shift: ${day} ${shiftReq.startTime}-${shiftReq.endTime}`);

      // Find the best employees for this shift
      const candidates = matcher.findBestEmployeesForShift(shiftReq, availabilities, employeeConstraints);
      
      if (candidates.length === 0) {
        console.warn(`No available employees for ${day} ${shiftReq.startTime}-${shiftReq.endTime}`);
        continue;
      }

      // Get optimal assignments
      const assignments = matcher.splitShiftRequirement(shiftReq, candidates);
      
      if (assignments.length === 0) {
        console.warn(`Could not create assignments for ${day} ${shiftReq.startTime}-${shiftReq.endTime}`);
        continue;
      }

      // Calculate coverage
      const coverage = matcher.calculateShiftCoverage(assignments, shiftReq);
      console.log(`Coverage: ${coverage.coveragePercentage.toFixed(1)}%, Employees: ${coverage.employeeCount}/${coverage.requiredEmployees}`);

      // Create shift records
      for (const assignment of assignments) {
        const shift = {
          employeeId: assignment.employeeId,
          companyId,
          departmentId: shiftReq.departmentId,
          weekStartDate: startDate,
          day,
          startTime: assignment.actualStartTime,
          endTime: assignment.actualEndTime,
          durationHours: assignment.overlapHours
        };

        shifts.push(shift);

        // Update constraints
        const empId = assignment.employeeId;
        employeeConstraints[empId].currentHours += assignment.overlapHours;
        employeeConstraints[empId].assignedDays.add(day);
        employeeConstraints[empId].alreadyAssignedToday = true;

        console.log(`Assigned: ${assignment.employee.name} (${assignment.actualStartTime}-${assignment.actualEndTime}, ${assignment.overlapHours.toFixed(2)}h)`);
      }
    }
  }

  return {
    shifts,
    employeeConstraints,
    summary: {
      totalShifts: shifts.length,
      employeesUsed: Object.keys(employeeConstraints).filter(empId => 
        employeeConstraints[empId].currentHours > 0
      ).length,
      averageHoursPerEmployee: Object.values(employeeConstraints)
        .map(c => c.currentHours)
        .filter(h => h > 0)
        .reduce((sum, h) => sum + h, 0) / Object.values(employeeConstraints).filter(c => c.currentHours > 0).length || 0
    }
  };
};