// Advanced Scheduling Optimization and Conflict Resolution
// Additional utilities for the flexible scheduling system

import { AvailabilityMatcher, enhancedAutoSchedule } from './availabilityMatcher.js';

export class SchedulingOptimizer {
  constructor() {
    this.daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  }

  // Analyze scheduling constraints and suggest optimizations
  analyzeSchedulingConstraints(availabilities, shiftRequirements) {
    const analysis = {
      employeeCount: availabilities.length,
      totalAvailableHours: 0,
      totalRequiredHours: 0,
      dayBreakdown: {},
      recommendations: []
    };

    // Calculate total available hours
    for (const avail of availabilities) {
      for (const day of this.daysOfWeek) {
        const dayAvail = avail.days[day];
        if (dayAvail && dayAvail.available) {
          let dayHours = 0;
          if (dayAvail.slots && dayAvail.slots.length > 0) {
            for (const slot of dayAvail.slots) {
              const startMinutes = this.timeToMinutes(slot.startTime);
              let endMinutes = this.timeToMinutes(slot.endTime);
              if (endMinutes <= startMinutes) endMinutes += 24 * 60;
              dayHours += (endMinutes - startMinutes) / 60;
            }
          } else {
            dayHours = 24; // All day availability
          }
          analysis.totalAvailableHours += dayHours;
        }
      }
    }

    // Calculate total required hours
    for (const requirement of shiftRequirements) {
      for (const day of this.daysOfWeek) {
        const daySlots = requirement[day] || [];
        for (const slot of daySlots) {
          const startMinutes = this.timeToMinutes(slot.startTime);
          let endMinutes = this.timeToMinutes(slot.endTime);
          if (endMinutes <= startMinutes) endMinutes += 24 * 60;
          const shiftHours = (endMinutes - startMinutes) / 60;
          const totalHours = shiftHours * slot.minEmployees;
          analysis.totalRequiredHours += totalHours;
        }
      }
    }

    // Day-by-day analysis
    for (const day of this.daysOfWeek) {
      const dayAnalysis = this.analyzeDayConstraints(day, availabilities, shiftRequirements);
      analysis.dayBreakdown[day] = dayAnalysis;
    }

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(analysis);

    return analysis;
  }

  analyzeDayConstraints(day, availabilities, shiftRequirements) {
    const dayAnalysis = {
      availableEmployees: 0,
      totalAvailableHours: 0,
      requiredEmployees: 0,
      totalRequiredHours: 0,
      shifts: [],
      coverage: 'unknown',
      issues: []
    };

    // Count available employees and hours
    for (const avail of availabilities) {
      const dayAvail = avail.days[day];
      if (dayAvail && dayAvail.available) {
        dayAnalysis.availableEmployees++;
        
        if (dayAvail.slots && dayAvail.slots.length > 0) {
          for (const slot of dayAvail.slots) {
            const startMinutes = this.timeToMinutes(slot.startTime);
            let endMinutes = this.timeToMinutes(slot.endTime);
            if (endMinutes <= startMinutes) endMinutes += 24 * 60;
            dayAnalysis.totalAvailableHours += (endMinutes - startMinutes) / 60;
          }
        } else {
          dayAnalysis.totalAvailableHours += 24;
        }
      }
    }

    // Calculate required coverage
    for (const requirement of shiftRequirements) {
      const daySlots = requirement[day] || [];
      for (const slot of daySlots) {
        const startMinutes = this.timeToMinutes(slot.startTime);
        let endMinutes = this.timeToMinutes(slot.endTime);
        if (endMinutes <= startMinutes) endMinutes += 24 * 60;
        const shiftHours = (endMinutes - startMinutes) / 60;
        
        dayAnalysis.shifts.push({
          startTime: slot.startTime,
          endTime: slot.endTime,
          minEmployees: slot.minEmployees,
          shiftHours,
          totalHours: shiftHours * slot.minEmployees
        });
        
        dayAnalysis.requiredEmployees += slot.minEmployees;
        dayAnalysis.totalRequiredHours += shiftHours * slot.minEmployees;
      }
    }

    // Determine coverage status
    if (dayAnalysis.availableEmployees >= dayAnalysis.requiredEmployees && 
        dayAnalysis.totalAvailableHours >= dayAnalysis.totalRequiredHours) {
      dayAnalysis.coverage = 'sufficient';
    } else if (dayAnalysis.availableEmployees > 0) {
      dayAnalysis.coverage = 'partial';
      if (dayAnalysis.availableEmployees < dayAnalysis.requiredEmployees) {
        dayAnalysis.issues.push(`Need ${dayAnalysis.requiredEmployees - dayAnalysis.availableEmployees} more employees`);
      }
      if (dayAnalysis.totalAvailableHours < dayAnalysis.totalRequiredHours) {
        dayAnalysis.issues.push(`Need ${(dayAnalysis.totalRequiredHours - dayAnalysis.totalAvailableHours).toFixed(1)} more hours`);
      }
    } else {
      dayAnalysis.coverage = 'none';
      dayAnalysis.issues.push('No employees available');
    }

    return dayAnalysis;
  }

  generateRecommendations(analysis) {
    const recommendations = [];

    // Overall capacity check
    if (analysis.totalRequiredHours > analysis.totalAvailableHours) {
      recommendations.push({
        type: 'capacity',
        priority: 'high',
        message: `Total required hours (${analysis.totalRequiredHours.toFixed(1)}) exceed available hours (${analysis.totalAvailableHours.toFixed(1)}). Consider reducing shift requirements or requesting more availability from employees.`
      });
    }

    // Day-specific recommendations
    for (const [day, dayData] of Object.entries(analysis.dayBreakdown)) {
      if (dayData.coverage === 'none') {
        recommendations.push({
          type: 'no_coverage',
          day,
          priority: 'high',
          message: `No employees available on ${day}. Shift requirements cannot be fulfilled.`
        });
      } else if (dayData.coverage === 'partial') {
        recommendations.push({
          type: 'partial_coverage',
          day,
          priority: 'medium',
          message: `${day} has partial coverage: ${dayData.issues.join(', ')}`
        });
      }
    }

    // Employee utilization
    const avgHoursPerEmployee = analysis.totalAvailableHours / analysis.employeeCount;
    if (avgHoursPerEmployee < 10) {
      recommendations.push({
        type: 'low_availability',
        priority: 'medium',
        message: `Low average availability per employee (${avgHoursPerEmployee.toFixed(1)} hours). Encourage employees to provide more availability.`
      });
    }

    return recommendations;
  }

  timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Optimize shift assignments to reduce gaps and overlaps
  optimizeShiftAssignments(assignments, shiftRequirement) {
    // Sort assignments by start time
    const sortedAssignments = [...assignments].sort((a, b) => 
      a.actualStartMinutes - b.actualStartMinutes
    );

    const optimized = [];
    const shiftDuration = this.timeToMinutes(shiftRequirement.endTime) - this.timeToMinutes(shiftRequirement.startTime);
    let currentCoverage = 0;

    for (const assignment of sortedAssignments) {
      // Check if this assignment is still needed
      const coverageGap = Math.max(0, shiftDuration - currentCoverage);
      
      if (coverageGap > 0) {
        optimized.push(assignment);
        currentCoverage += assignment.overlapMinutes;
      }
      
      // Stop if we have full coverage
      if (currentCoverage >= shiftDuration) break;
    }

    return optimized;
  }

  // Suggest alternative shift configurations
  suggestShiftAlternatives(shiftRequirement, availabilities) {
    const alternatives = [];
    
    // Get all potential time ranges from availability
    const availableTimeRanges = [];
    for (const avail of availabilities) {
      const dayAvail = avail.days[shiftRequirement.day];
      if (dayAvail && dayAvail.available) {
        for (const slot of dayAvail.slots || []) {
          availableTimeRanges.push({
            start: this.timeToMinutes(slot.startTime),
            end: this.timeToMinutes(slot.endTime),
            employee: avail.employeeId
          });
        }
      }
    }

    // Find common availability windows
    const timeSlots = Array(24 * 60).fill(0); // Minutes in a day
    for (const range of availableTimeRanges) {
      let end = range.end;
      if (end <= range.start) end += 24 * 60; // Handle overnight
      
      for (let i = range.start; i < Math.min(end, 24 * 60); i++) {
        timeSlots[i]++;
      }
    }

    // Find periods with sufficient coverage
    const minEmployees = shiftRequirement.minEmployees;
    const originalDuration = this.timeToMinutes(shiftRequirement.endTime) - this.timeToMinutes(shiftRequirement.startTime);
    
    for (let duration = originalDuration; duration >= Math.min(4 * 60, originalDuration / 2); duration -= 30) {
      for (let start = 0; start < 24 * 60 - duration; start += 30) {
        let minCoverage = Infinity;
        for (let i = start; i < start + duration; i++) {
          minCoverage = Math.min(minCoverage, timeSlots[i]);
        }
        
        if (minCoverage >= minEmployees) {
          const startTime = this.minutesToTime(start);
          const endTime = this.minutesToTime(start + duration);
          
          alternatives.push({
            startTime,
            endTime,
            duration: duration / 60,
            availableEmployees: minCoverage,
            score: minCoverage * (duration / originalDuration) // Prefer longer shifts with more coverage
          });
        }
      }
    }

    // Sort by score and return top alternatives
    return alternatives
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  // Generate a detailed scheduling report
  generateSchedulingReport(analysis, shifts, conflicts) {
    const report = {
      summary: {
        totalShifts: shifts.length,
        totalConflicts: conflicts.length,
        successRate: ((shifts.length / (shifts.length + conflicts.length)) * 100).toFixed(1),
        totalHours: shifts.reduce((sum, shift) => sum + shift.durationHours, 0).toFixed(1),
        averageShiftLength: shifts.length > 0 ? 
          (shifts.reduce((sum, shift) => sum + shift.durationHours, 0) / shifts.length).toFixed(1) : 0
      },
      dailyBreakdown: {},
      employeeUtilization: {},
      recommendations: analysis.recommendations,
      conflicts: conflicts
    };

    // Daily breakdown
    for (const day of this.daysOfWeek) {
      const dayShifts = shifts.filter(shift => shift.day === day);
      const dayConflicts = conflicts.filter(conflict => conflict.day === day);
      
      report.dailyBreakdown[day] = {
        shifts: dayShifts.length,
        conflicts: dayConflicts.length,
        hours: dayShifts.reduce((sum, shift) => sum + shift.durationHours, 0).toFixed(1),
        employees: new Set(dayShifts.map(shift => shift.employeeId)).size
      };
    }

    // Employee utilization
    const employeeHours = {};
    for (const shift of shifts) {
      const empId = shift.employeeId.toString();
      employeeHours[empId] = (employeeHours[empId] || 0) + shift.durationHours;
    }

    for (const [empId, hours] of Object.entries(employeeHours)) {
      report.employeeUtilization[empId] = {
        totalHours: hours.toFixed(1),
        shiftsCount: shifts.filter(shift => shift.employeeId.toString() === empId).length,
        averageShiftLength: (hours / shifts.filter(shift => shift.employeeId.toString() === empId).length).toFixed(1)
      };
    }

    return report;
  }

  // Validate shift assignments for conflicts
  validateShiftAssignments(shifts) {
    const conflicts = [];
    const employeeDailyShifts = {};

    // Group shifts by employee and day
    for (const shift of shifts) {
      const empId = shift.employeeId.toString();
      const day = shift.day;
      
      if (!employeeDailyShifts[empId]) {
        employeeDailyShifts[empId] = {};
      }
      if (!employeeDailyShifts[empId][day]) {
        employeeDailyShifts[empId][day] = [];
      }
      
      employeeDailyShifts[empId][day].push(shift);
    }

    // Check for overlapping shifts
    for (const [empId, dailyShifts] of Object.entries(employeeDailyShifts)) {
      for (const [day, dayShifts] of Object.entries(dailyShifts)) {
        if (dayShifts.length > 1) {
          // Sort shifts by start time
          const sortedShifts = dayShifts.sort((a, b) => 
            this.timeToMinutes(a.startTime) - this.timeToMinutes(b.startTime)
          );

          for (let i = 0; i < sortedShifts.length - 1; i++) {
            const current = sortedShifts[i];
            const next = sortedShifts[i + 1];
            
            const currentEnd = this.timeToMinutes(current.endTime);
            const nextStart = this.timeToMinutes(next.startTime);
            
            // Check for overlap (allowing for same end/start time)
            if (currentEnd > nextStart) {
              conflicts.push({
                type: 'overlap',
                employeeId: empId,
                day: day,
                shift1: `${current.startTime}-${current.endTime}`,
                shift2: `${next.startTime}-${next.endTime}`,
                message: `Employee has overlapping shifts on ${day}`
              });
            }
          }
        }
      }
    }

    return conflicts;
  }

  // Smart gap filling - try to fill scheduling gaps with available employees
  fillSchedulingGaps(unfulfilled, availabilities, existingAssignments = []) {
    const filledGaps = [];
    
    for (const gap of unfulfilled) {
      console.log(`Attempting to fill gap: ${gap.day} ${gap.startTime}-${gap.endTime}`);
      
      // Find employees not already assigned on this day
      const assignedEmployees = new Set(
        existingAssignments
          .filter(assignment => assignment.day === gap.day)
          .map(assignment => assignment.employeeId.toString())
      );

      const availableEmployees = availabilities.filter(avail => 
        !assignedEmployees.has(avail.employeeId._id.toString())
      );

      // Use the matcher to find candidates
      const matcher = new AvailabilityMatcher();
      const candidates = matcher.findBestEmployeesForShift(gap, availableEmployees);
      
      if (candidates.length > 0) {
        // Take the best candidate
        const bestCandidate = candidates[0];
        
        filledGaps.push({
          gap: gap,
          assignment: bestCandidate,
          confidence: bestCandidate.coveragePercentage
        });
        
        console.log(`Filled gap with ${bestCandidate.employee.name} (${bestCandidate.coveragePercentage.toFixed(1)}% coverage)`);
      }
    }

    return filledGaps;
  }

  // Advanced conflict resolution strategies
  resolveSchedulingConflicts(conflicts, availabilities, shiftRequirements) {
    const resolutions = [];

    for (const conflict of conflicts) {
      const resolution = {
        originalConflict: conflict,
        strategies: []
      };

      // Strategy 1: Adjust shift times
      if (conflict.issue === 'Insufficient employees available') {
        const alternatives = this.suggestShiftAlternatives(
          conflict, 
          availabilities.filter(avail => 
            avail.employeeId.departmentId.toString() === conflict.departmentId?.toString()
          )
        );
        
        if (alternatives.length > 0) {
          resolution.strategies.push({
            type: 'time_adjustment',
            description: 'Adjust shift times to match available employee schedules',
            alternatives: alternatives.slice(0, 3)
          });
        }
      }

      // Strategy 2: Split shifts
      if (conflict.required > conflict.assigned && conflict.assigned > 0) {
        resolution.strategies.push({
          type: 'split_shift',
          description: 'Split the shift into smaller segments that can be covered by available employees',
          suggestion: `Consider splitting the ${conflict.startTime}-${conflict.endTime} shift into 2-3 shorter shifts`
        });
      }

      // Strategy 3: Reduce requirements
      if (conflict.required > conflict.availableEmployees?.length) {
        resolution.strategies.push({
          type: 'reduce_requirements',
          description: 'Reduce minimum employee requirements for this shift',
          suggestion: `Consider reducing from ${conflict.required} to ${Math.max(1, conflict.availableEmployees?.length || 0)} employees`
        });
      }

      // Strategy 4: Request more availability
      resolution.strategies.push({
        type: 'request_availability',
        description: 'Request additional availability from employees',
        suggestion: `Contact employees to submit availability for ${conflict.day} ${conflict.startTime}-${conflict.endTime}`
      });

      resolutions.push(resolution);
    }

    return resolutions;
  }
}

export class SchedulingCoordinator {
  constructor() {
    this.matcher = new AvailabilityMatcher();
    this.optimizer = new SchedulingOptimizer();
  }

  async generateOptimizedSchedule(companyId, departmentId, startDate, endDate, shiftRequirements, availabilities) {
    console.log('Starting optimized schedule generation...');
    
    // Step 1: Analyze constraints
    const analysis = this.optimizer.analyzeSchedulingConstraints(availabilities, shiftRequirements);
    console.log('Constraint analysis:', {
      totalAvailable: analysis.totalAvailableHours.toFixed(1),
      totalRequired: analysis.totalRequiredHours.toFixed(1),
      recommendations: analysis.recommendations.length
    });

    // Step 2: Generate initial schedule
    const { shifts, employeeConstraints } = await this.generateBaseSchedule(
      companyId, departmentId, startDate, endDate, shiftRequirements, availabilities
    );

    // Step 3: Validate and identify conflicts
    const validationConflicts = this.optimizer.validateShiftAssignments(shifts);
    console.log(`Validation found ${validationConflicts.length} conflicts`);

    // Step 4: Attempt to resolve conflicts
    const unfulfilled = this.identifyUnfulfilledRequirements(shiftRequirements, shifts);
    const gapFills = this.optimizer.fillSchedulingGaps(unfulfilled, availabilities, shifts);
    
    // Step 5: Generate final report
    const report = this.optimizer.generateSchedulingReport(analysis, shifts, validationConflicts);
    
    return {
      shifts,
      report,
      conflicts: validationConflicts,
      gapFills,
      recommendations: analysis.recommendations
    };
  }

  async generateBaseSchedule(companyId, departmentId, startDate, endDate, shiftRequirements, availabilities) {
    // Use the enhanced matcher for base schedule generation
    const result = await enhancedAutoSchedule(companyId, departmentId, startDate, endDate, shiftRequirements, availabilities);
    return result;
  }

  identifyUnfulfilledRequirements(shiftRequirements, generatedShifts) {
    const unfulfilled = [];
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    for (const requirement of shiftRequirements) {
      for (const day of daysOfWeek) {
        const daySlots = requirement[day] || [];
        
        for (const slot of daySlots) {
          // Count how many employees were assigned to this exact shift
          const assignedCount = generatedShifts.filter(shift => 
            shift.day === day &&
            shift.startTime === slot.startTime &&
            shift.endTime === slot.endTime
          ).length;

          if (assignedCount < slot.minEmployees) {
            unfulfilled.push({
              ...slot,
              day,
              departmentId: requirement.departmentId,
              required: slot.minEmployees,
              assigned: assignedCount,
              shortfall: slot.minEmployees - assignedCount
            });
          }
        }
      }
    }

    return unfulfilled;
  }
}